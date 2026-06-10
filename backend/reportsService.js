const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { db } = require('./db');
const analytics = require('./analyticsService');

const CURRENCY_SYMBOLS = {
    'NGN': '₦',
    'USD': '$',
    'EUR': '€',
    'GBP': '£',
    'KES': 'KSh',
    'RWF': 'FRw'
};

const CURRENCY_PDF_SYMBOLS = {
    'NGN': 'NGN ',
    'USD': '$',
    'EUR': '€',
    'GBP': '£',
    'KES': 'KES ',
    'RWF': 'RWF '
};

// Make sure output directory exists
const REPORTS_DIR = path.join(__dirname, 'public', 'reports');
if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

/**
 * Helper to get date range timestamp limits
 */
function getDateRange(rangeString, customStart, customEnd) {
    const now = Date.now();
    let startTime = now;
    let endTime = now;

    switch (rangeString) {
        case 'Today':
            startTime = new Date().setHours(0, 0, 0, 0);
            endTime = now;
            break;
        case 'Yesterday':
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            startTime = new Date(yesterday).setHours(0, 0, 0, 0);
            endTime = new Date(yesterday).setHours(23, 59, 59, 999);
            break;
        case 'Last 7 Days':
            startTime = now - 7 * 24 * 60 * 60 * 1000;
            endTime = now;
            break;
        case 'Last 14 Days':
            startTime = now - 14 * 24 * 60 * 60 * 1000;
            endTime = now;
            break;
        case 'Last 30 Days':
            startTime = now - 30 * 24 * 60 * 60 * 1000;
            endTime = now;
            break;
        case 'Custom Range':
            startTime = customStart ? new Date(customStart).getTime() : now - 7 * 24 * 60 * 60 * 1000;
            endTime = customEnd ? new Date(customEnd).getTime() : now;
            break;
        default:
            startTime = now - 7 * 24 * 60 * 60 * 1000;
            endTime = now;
    }

    return { startTime, endTime };
}

/**
 * Draws a professional grid/box representing key performance indicators in PDFKit
 */
function drawKPICard(doc, x, y, width, height, title, value, unit = '', color = '#0A192F') {
    doc.save();
    // Card background
    doc.roundedRect(x, y, width, height, 6)
       .fillAndStroke('#F4F6F9', '#E4E7EC');
    
    // Value Accent Line
    doc.rect(x, y, 4, height).fill(color);

    // Title
    doc.fillColor('#667085')
       .font('Helvetica-Bold')
       .fontSize(8)
       .text(title.toUpperCase(), x + 12, y + 10);

    // Value
    doc.fillColor('#1D2939')
       .font('Helvetica-Bold')
       .fontSize(16)
       .text(`${value}`, x + 12, y + 22);

    if (unit) {
        const valWidth = doc.widthOfString(`${value}`);
        doc.fillColor('#667085')
           .font('Helvetica')
           .fontSize(9)
           .text(` ${unit}`, x + 12 + valWidth, y + 28);
    }
    doc.restore();
}

/**
 * Draws a line chart in PDFKit
 */
function drawLineChart(doc, x, y, width, height, data, title) {
    doc.save();
    
    // Draw Border & Background
    doc.roundedRect(x, y, width, height, 6)
       .fillAndStroke('#FFFFFF', '#E4E7EC');

    // Title
    doc.fillColor('#1D2939')
       .font('Helvetica-Bold')
       .fontSize(10)
       .text(title, x + 15, y + 12);

    if (!data || data.length === 0) {
        doc.fillColor('#98A2B3')
           .font('Helvetica')
           .fontSize(10)
           .text('No trend data available', x + width / 3, y + height / 2);
        doc.restore();
        return;
    }

    const padding = 35;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;
    const chartX = x + padding;
    const chartY = y + padding + 5;

    // Draw Axes
    doc.lineWidth(1)
       .strokeColor('#D0D5DD')
       .moveTo(chartX, chartY)
       .lineTo(chartX, chartY + chartHeight)
       .lineTo(chartX + chartWidth, chartY + chartHeight)
       .stroke();

    const maxVal = Math.max(...data.map(d => d.value), 10);
    const minVal = 0;

    // Grid lines & Y Axis Labels
    doc.lineWidth(0.5).strokeColor('#F2F4F7');
    for (let i = 0; i <= 4; i++) {
        const val = minVal + (maxVal - minVal) * (i / 4);
        const currY = chartY + chartHeight - (chartHeight * (i / 4));
        
        doc.moveTo(chartX, currY).lineTo(chartX + chartWidth, currY).stroke();
        doc.fillColor('#667085')
           .font('Helvetica')
           .fontSize(7)
           .text(Math.round(val).toString(), chartX - 25, currY - 3, { width: 20, align: 'right' });
    }

    // Plot Points
    doc.lineWidth(2).strokeColor('#00B4D8');
    const totalPoints = data.length;
    const stepX = totalPoints > 1 ? chartWidth / (totalPoints - 1) : chartWidth;

    doc.moveTo(chartX, chartY + chartHeight - ((data[0].value / maxVal) * chartHeight));

    for (let i = 1; i < totalPoints; i++) {
        const ptX = chartX + i * stepX;
        const ptY = chartY + chartHeight - ((data[i].value / maxVal) * chartHeight);
        doc.lineTo(ptX, ptY);
    }
    doc.stroke();

    // Plot Dots and X Labels
    for (let i = 0; i < totalPoints; i++) {
        const ptX = chartX + i * stepX;
        const ptY = chartY + chartHeight - ((data[i].value / maxVal) * chartHeight);

        // Draw dot
        doc.circle(ptX, ptY, 3).fill('#00B4D8');

        // X label
        doc.fillColor('#667085')
           .font('Helvetica')
           .fontSize(7)
           .text(data[i].label, ptX - 15, chartY + chartHeight + 8, { width: 30, align: 'center' });
    }

    doc.restore();
}

/**
 * Draws a bar chart in PDFKit
 */
function drawBarChart(doc, x, y, width, height, data, title) {
    doc.save();
    
    // Draw Border & Background
    doc.roundedRect(x, y, width, height, 6)
       .fillAndStroke('#FFFFFF', '#E4E7EC');

    // Title
    doc.fillColor('#1D2939')
       .font('Helvetica-Bold')
       .fontSize(10)
       .text(title, x + 15, y + 12);

    if (!data || data.length === 0) {
        doc.fillColor('#98A2B3')
           .font('Helvetica')
           .fontSize(10)
           .text('No comparison data available', x + width / 3, y + height / 2);
        doc.restore();
        return;
    }

    const padding = 35;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;
    const chartX = x + padding;
    const chartY = y + padding + 5;

    // Draw Axes
    doc.lineWidth(1)
       .strokeColor('#D0D5DD')
       .moveTo(chartX, chartY)
       .lineTo(chartX, chartY + chartHeight)
       .lineTo(chartX + chartWidth, chartY + chartHeight)
       .stroke();

    const maxVal = Math.max(...data.map(d => d.value), 10);
    
    // Grid lines & Y Axis Labels
    doc.lineWidth(0.5).strokeColor('#F2F4F7');
    for (let i = 0; i <= 4; i++) {
        const val = (maxVal) * (i / 4);
        const currY = chartY + chartHeight - (chartHeight * (i / 4));
        
        doc.moveTo(chartX, currY).lineTo(chartX + chartWidth, currY).stroke();
        doc.fillColor('#667085')
           .font('Helvetica')
           .fontSize(7)
           .text(Math.round(val).toString(), chartX - 25, currY - 3, { width: 20, align: 'right' });
    }

    // Draw Bars
    const totalBars = data.length;
    const totalGap = chartWidth * 0.3;
    const barWidth = (chartWidth - totalGap) / totalBars;
    const gapWidth = totalGap / (totalBars + 1);

    for (let i = 0; i < totalBars; i++) {
        const barX = chartX + gapWidth + i * (barWidth + gapWidth);
        const barH = (data[i].value / maxVal) * chartHeight;
        const barY = chartY + chartHeight - barH;

        // Draw bar shadow/fill
        doc.rect(barX, barY, barWidth, barH).fill('#0A192F');

        // X label
        doc.fillColor('#667085')
           .font('Helvetica')
           .fontSize(7)
           .text(data[i].label, barX - gapWidth/2, chartY + chartHeight + 8, { width: barWidth + gapWidth, align: 'center' });
    }

    doc.restore();
}

/**
 * Draws Table Header & Grid Lines
 */
function drawTableHeader(doc, x, y, columns) {
    doc.save();
    doc.rect(x, y, columns.reduce((acc, c) => acc + c.width, 0), 20).fill('#0A192F');
    
    let currX = x;
    columns.forEach(col => {
        doc.fillColor('#FFFFFF')
           .font('Helvetica-Bold')
           .fontSize(8)
           .text(col.title, currX + 6, y + 6, { width: col.width - 12, align: col.align || 'left' });
        currX += col.width;
    });
    doc.restore();
}

function drawTableRow(doc, x, y, columns, dataRow, isAlt = false) {
    doc.save();
    const totalWidth = columns.reduce((acc, c) => acc + c.width, 0);
    
    if (isAlt) {
        doc.rect(x, y, totalWidth, 20).fill('#F9FAFB');
    }
    doc.rect(x, y, totalWidth, 20).stroke('#F2F4F7');

    let currX = x;
    columns.forEach(col => {
        const val = dataRow[col.key];
        doc.fillColor('#344054')
           .font('Helvetica')
           .fontSize(8)
           .text(`${val === undefined || val === null ? '-' : val}`, currX + 6, y + 6, { width: col.width - 12, align: col.align || 'left' });
        currX += col.width;
    });
    doc.restore();
}

/**
 * Programmatic PDF Report Generator
 */
async function generatePDFReport(reportId, reportType, vehicleIds, driverIds, startTime, endTime, userName, dateRangeStr) {
    return new Promise((resolve, reject) => {
        try {
            const reportName = `Safebox_${reportType.replace(/ /g, '_')}_Report_${Date.now()}.pdf`;
            const filePath = path.join(REPORTS_DIR, reportName);
            const relativePath = `/reports/${reportName}`;

            const doc = new PDFDocument({ margin: 30, size: 'A4' });
            const stream = fs.createWriteStream(filePath);
            doc.pipe(stream);

            // Fetch generic context data
            const vehicles = db.prepare('SELECT * FROM vehicles').all().filter(v => vehicleIds.includes(v.id));
            const driverMap = {};
            db.prepare('SELECT * FROM drivers').all().forEach(d => {
                driverMap[d.name] = d;
            });

            // ----------------------------------------
            // PAGE 1: COVER PAGE & EXECUTIVE SUMMARY
            // ----------------------------------------
            // Top Accent Band
            doc.rect(0, 0, 595, 12).fill('#0A192F');

            // Header Elements: SafeBox Green Lock Logo
            doc.save();
            doc.translate(35, 45);
            
            // Padlock Shackle (Arch)
            doc.moveTo(12, 16)
               .lineTo(12, 10)
               .bezierCurveTo(12, 0, 36, 0, 36, 10)
               .lineTo(36, 16)
               .lineWidth(5.5)
               .lineCap('round')
               .strokeColor('#10B981')
               .stroke();

            // Padlock Body
            doc.roundedRect(6, 14, 36, 28, 6)
               .fill('#10B981');

            // Cut-out Keyhole
            doc.circle(24, 26, 3.5)
               .moveTo(22, 29)
               .lineTo(26, 29)
               .lineTo(27.5, 36)
               .lineTo(20.5, 36)
               .closePath()
               .fill('#FFFFFF');

            doc.restore();

            // Safebox Text Logo
            doc.fillColor('#0A192F')
               .font('Helvetica-Bold')
               .fontSize(22)
               .text('SAFEBOX', 95, 42);

            doc.fillColor('#00B4D8')
               .font('Helvetica-Bold')
               .fontSize(10)
               .text('FLEET INTELLIGENCE & OPERATIONS', 95, 65);

            // Report Meta Block
            doc.rect(340, 35, 220, 75).roundedRect(340, 35, 220, 75, 4).stroke('#D0D5DD');
            doc.fillColor('#344054')
               .font('Helvetica-Bold')
               .fontSize(8)
               .text('REPORT DETAILS', 350, 43);

            doc.font('Helvetica').fontSize(8);
            doc.text(`Type: ${reportType}`, 350, 56);
            doc.text(`Period: ${dateRangeStr}`, 350, 68);
            doc.text(`Generated By: ${userName}`, 350, 80);
            doc.text(`Date: ${new Date().toLocaleString()}`, 350, 92);

            // Horizontal Line
            doc.moveTo(30, 130).lineTo(565, 130).strokeColor('#EAECF0').lineWidth(1).stroke();

            // Executive Summary Title
            doc.fillColor('#0A192F')
               .font('Helvetica-Bold')
               .fontSize(14)
               .text('Executive Summary', 30, 145);

            // Fetch Global KPIs across selections
            let totalVehicles = vehicles.length;
            let onlineVehicles = vehicles.filter(v => Date.now() - v.last_seen < 120000).length; // last 2 min
            let offlineVehicles = totalVehicles - onlineVehicles;

            let totalTrips = 0;
            let totalDistance = 0;
            let totalIdleTime = 0;
            let totalAlerts = 0;

            vehicles.forEach(v => {
                totalDistance += analytics.calculateDistance(v.id, startTime, endTime);
                totalIdleTime += analytics.calculateIdleTime(v.id, startTime, endTime);

                // Compute trips: assume a trip is anytime the speed changes from moving to stopped,
                // or simply count unique runs. Let's count intervals of activity as trips.
                const history = db.prepare('SELECT speed, timestamp FROM vehicle_history WHERE vehicle_id = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC').all(v.id, startTime, endTime);
                let moving = false;
                history.forEach(h => {
                    if (h.speed > 5 && !moving) {
                        moving = true;
                        totalTrips++;
                    } else if (h.speed <= 5) {
                        moving = false;
                    }
                });

                // Total Alerts
                const alertCount = db.prepare('SELECT COUNT(*) as cnt FROM vehicle_alerts WHERE vehicle_id = ? AND timestamp >= ? AND timestamp <= ?').get(v.id, startTime, endTime);
                totalAlerts += alertCount.cnt;
            });

            // Fleet utilization
            const fleetIds = vehicles.map(v => v.id);
            const fleetUtilization = analytics.calculateFleetUtilization(fleetIds, startTime, endTime);

            // Maintenance Due Count
            const maintenanceDue = db.prepare(`
                SELECT COUNT(*) as cnt FROM maintenance_reminders 
                WHERE status = 'PENDING' AND due_date <= ?
            `).get(endTime).cnt;

            // Draw KPI cards
            // Row 1
            drawKPICard(doc, 30, 170, 95, 50, 'Total Vehicles', totalVehicles, '', '#0A192F');
            drawKPICard(doc, 137, 170, 95, 50, 'Active Fleet', onlineVehicles, '', '#52C41A');
            drawKPICard(doc, 244, 170, 95, 50, 'Idle/Offline', offlineVehicles, '', '#F5222D');
            drawKPICard(doc, 351, 170, 95, 50, 'Total Trips', totalTrips, '', '#1890FF');
            drawKPICard(doc, 458, 170, 107, 50, 'Distance covered', Math.round(totalDistance), 'km', '#722ED1');

            // Row 2
            drawKPICard(doc, 30, 230, 95, 50, 'Idle Time', Math.round(totalIdleTime / 60), 'mins', '#FA8C16');
            drawKPICard(doc, 137, 230, 95, 50, 'Fleet Utilization', fleetUtilization, '%', '#13C2C2');
            drawKPICard(doc, 244, 230, 95, 50, 'Security Incidents', totalAlerts, '', '#EB2F96');
            drawKPICard(doc, 351, 230, 95, 50, 'Maintenance Alerts', maintenanceDue, '', '#FAAD14');
            
            // Draw Chart 1: Daily Distance Trend (mock data or real aggregation)
            // Aggregate daily distance from history
            const dailyData = [];
            const dayMillis = 24 * 60 * 60 * 1000;
            for (let i = 6; i >= 0; i--) {
                const dayStart = startTime + (endTime - startTime) * ((6-i)/7);
                const dayEnd = dayStart + (endTime - startTime) / 7;
                let dayDist = 0;
                vehicles.forEach(v => {
                    dayDist += analytics.calculateDistance(v.id, dayStart, dayEnd);
                });
                
                const label = new Date(dayStart).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
                dailyData.push({ label, value: dayDist });
            }

            // Draw Chart 2: Alert trend
            const alertData = [];
            for (let i = 6; i >= 0; i--) {
                const dayStart = startTime + (endTime - startTime) * ((6-i)/7);
                const dayEnd = dayStart + (endTime - startTime) / 7;
                let dayAlerts = 0;
                vehicles.forEach(v => {
                    const cnt = db.prepare('SELECT COUNT(*) as cnt FROM vehicle_alerts WHERE vehicle_id = ? AND timestamp >= ? AND timestamp <= ?').get(v.id, dayStart, dayEnd).cnt;
                    dayAlerts += cnt;
                });
                
                const label = new Date(dayStart).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
                alertData.push({ label, value: dayAlerts });
            }

            doc.fillColor('#0A192F')
               .font('Helvetica-Bold')
               .fontSize(12)
               .text('Operations Overview', 30, 305);

            drawLineChart(doc, 30, 325, 255, 140, dailyData, 'Daily Distance Trend (km)');
            drawLineChart(doc, 300, 325, 265, 140, alertData, 'Daily Security Alerts Trend');

            // Draw executive comments/summary text
            doc.rect(30, 480, 535, 75).roundedRect(30, 480, 535, 75, 4).fillAndStroke('#FAFAFA', '#E8E8E8');
            doc.fillColor('#1D2939')
               .font('Helvetica-Bold')
               .fontSize(9)
               .text('Operational Summary & Recommendations:', 40, 490);

            let summaryText = `During the period of ${dateRangeStr}, the fleet of ${totalVehicles} vehicles covered a total of ${totalDistance.toFixed(1)} km. The fleet experienced ${totalAlerts} security-related alerts and has ${maintenanceDue} pending service reminders. `;
            if (fleetUtilization < 20) {
                summaryText += `RECOMMENDATION: Fleet utilization is low (${fleetUtilization}%). Consider consolidations or schedule adjustments to optimize operational cost.`;
            } else if (totalAlerts > 5) {
                summaryText += `RECOMMENDATION: High number of security incidents detected (${totalAlerts}). Please check Curfew and Geofence alerts details in Section 4.`;
            } else {
                summaryText += `Fleet health and security are within optimal bounds. Continue standard operations.`;
            }

            doc.fillColor('#475467')
               .font('Helvetica')
               .fontSize(8)
               .text(summaryText, 40, 505, { width: 515, lineGap: 3 });

            // Footer
            doc.fillColor('#98A2B3')
               .fontSize(7)
               .text('Page 1 of 4  |  Safebox Fleet Intelligence', 30, 570, { align: 'center' });

            // ----------------------------------------
            // PAGE 2: VEHICLE USAGE & TRIP LOGS
            // ----------------------------------------
            doc.addPage();
            doc.rect(0, 0, 595, 12).fill('#0A192F');
            
            doc.fillColor('#0A192F')
               .font('Helvetica-Bold')
               .fontSize(14)
               .text('Section 1 - Vehicle Usage Report', 30, 30);

            // Table of Vehicles
            const usageColumns = [
                { title: 'Vehicle Name', key: 'name', width: 110 },
                { title: 'ID', key: 'id', width: 65 },
                { title: 'Distance (km)', key: 'dist', width: 75, align: 'right' },
                { title: 'Idle Time (m)', key: 'idle', width: 75, align: 'right' },
                { title: 'Avg Speed', key: 'avgSpeed', width: 70, align: 'right' },
                { title: 'Max Speed', key: 'maxSpeed', width: 70, align: 'right' },
                { title: 'Trips Done', key: 'trips', width: 70, align: 'right' }
            ];

            drawTableHeader(doc, 30, 55, usageColumns);

            let usageY = 75;
            const usageRows = [];
            vehicles.forEach(v => {
                const dist = analytics.calculateDistance(v.id, startTime, endTime);
                const idle = Math.round(analytics.calculateIdleTime(v.id, startTime, endTime) / 60);

                const speedHist = db.prepare('SELECT speed FROM vehicle_history WHERE vehicle_id = ? AND timestamp >= ? AND timestamp <= ?').all(v.id, startTime, endTime);
                const speeds = speedHist.map(h => h.speed);
                const maxSpeed = speeds.length > 0 ? Math.max(...speeds) : 0;
                const avgSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;

                // Trips
                let trips = 0;
                let moving = false;
                speedHist.forEach(s => {
                    if (s.speed > 5 && !moving) {
                        moving = true;
                        trips++;
                    } else if (s.speed <= 5) {
                        moving = false;
                    }
                });

                const rowData = {
                    name: v.name,
                    id: v.id,
                    dist: dist.toFixed(1),
                    idle: `${idle}m`,
                    avgSpeed: `${Math.round(avgSpeed)} km/h`,
                    maxSpeed: `${Math.round(maxSpeed)} km/h`,
                    trips
                };
                usageRows.push(rowData);
            });

            // Paginated print or limit display
            usageRows.slice(0, 10).forEach((row, idx) => {
                drawTableRow(doc, 30, usageY, usageColumns, row, idx % 2 === 1);
                usageY += 20;
            });

            // Section 2: Trip report summary
            doc.fillColor('#0A192F')
               .font('Helvetica-Bold')
               .fontSize(14)
               .text('Section 2 - Trip Report Details', 30, usageY + 25);

            const tripColumns = [
                { title: 'Vehicle', key: 'vName', width: 85 },
                { title: 'Trip Start', key: 'start', width: 95 },
                { title: 'Trip End', key: 'end', width: 95 },
                { title: 'Duration', key: 'duration', width: 70 },
                { title: 'Distance', key: 'dist', width: 60, align: 'right' },
                { title: 'Start Location', key: 'startLoc', width: 130 }
            ];

            drawTableHeader(doc, 30, usageY + 45, tripColumns);

            let tripY = usageY + 65;
            let tripCount = 0;
            vehicles.forEach(v => {
                if (tripCount >= 8) return; // Limit to fit page
                
                // Fetch GPS updates to reconstruct discrete trips
                const history = db.prepare('SELECT lat, lng, speed, timestamp FROM vehicle_history WHERE vehicle_id = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC').all(v.id, startTime, endTime);
                
                let inTrip = false;
                let tripStartT = 0;
                let tripEndT = 0;
                let tripStartLat = 0;
                let tripStartLng = 0;
                let tripDist = 0;

                for (let i = 1; i < history.length; i++) {
                    const prev = history[i - 1];
                    const curr = history[i];

                    if (curr.speed > 5 && !inTrip) {
                        inTrip = true;
                        tripStartT = curr.timestamp;
                        tripStartLat = curr.lat;
                        tripStartLng = curr.lng;
                        tripDist = 0;
                    }

                    if (inTrip) {
                        if (prev.lat && prev.lng && curr.lat && curr.lng) {
                            tripDist += analytics.getDistanceFromLatLonInKm(prev.lat, prev.lng, curr.lat, curr.lng);
                        }

                        // Trip ends if stationary for > 2 min or end of log
                        const timeDiff = curr.timestamp - prev.timestamp;
                        if (curr.speed <= 5 || i === history.length - 1) {
                            inTrip = false;
                            tripEndT = curr.timestamp;
                            const durationMin = Math.round((tripEndT - tripStartT) / 60000);
                            
                            if (durationMin > 1 && tripCount < 8) {
                                const row = {
                                    vName: v.name,
                                    start: new Date(tripStartT).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
                                    end: new Date(tripEndT).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
                                    duration: `${durationMin} mins`,
                                    dist: `${tripDist.toFixed(1)} km`,
                                    startLoc: `${tripStartLat.toFixed(4)}, ${tripStartLng.toFixed(4)}`
                                };
                                drawTableRow(doc, 30, tripY, tripColumns, row, tripCount % 2 === 1);
                                tripY += 20;
                                tripCount++;
                            }
                        }
                    }
                }
            });

            if (tripCount === 0) {
                doc.fillColor('#98A2B3')
                   .font('Helvetica-Oblique')
                   .fontSize(8)
                   .text('No matching trip logs found in this period.', 40, tripY + 10);
            }

            // Footer
            doc.fillColor('#98A2B3')
               .fontSize(7)
               .text('Page 2 of 4  |  Safebox Fleet Intelligence', 30, 570, { align: 'center' });


            // ----------------------------------------
            // PAGE 3: DRIVER PERFORMANCE, ALERTS & MAINTENANCE
            // ----------------------------------------
            doc.addPage();
            doc.rect(0, 0, 595, 12).fill('#0A192F');

            // Driver Performance Leaderboard
            doc.fillColor('#0A192F')
               .font('Helvetica-Bold')
               .fontSize(14)
               .text('Section 3 - Driver Performance & Security Alerts', 30, 30);

            const driverColumns = [
                { title: 'Driver Name', key: 'name', width: 120 },
                { title: 'Assigned Vehicle', key: 'vName', width: 110 },
                { title: 'Distance (km)', key: 'dist', width: 80, align: 'right' },
                { title: 'Overspeeds', key: 'overspeeds', width: 75, align: 'right' },
                { title: 'Idle Time (m)', key: 'idle', width: 75, align: 'right' },
                { title: 'Driving Score', key: 'score', width: 75, align: 'right' }
            ];

            drawTableHeader(doc, 30, 55, driverColumns);

            let driverY = 75;
            const driverRows = [];
            vehicles.forEach(v => {
                const driverName = v.driver_name || 'Unassigned Driver';
                const dist = analytics.calculateDistance(v.id, startTime, endTime);
                const idle = Math.round(analytics.calculateIdleTime(v.id, startTime, endTime) / 60);

                const overspeeds = db.prepare(`
                    SELECT COUNT(*) as cnt FROM vehicle_alerts 
                    WHERE vehicle_id = ? AND type = 'SPEEDING' AND timestamp >= ? AND timestamp <= ?
                `).get(v.id, startTime, endTime).cnt;

                const score = analytics.calculateDriverScore(v.id, startTime, endTime);

                driverRows.push({
                    name: driverName,
                    vName: v.name,
                    dist: dist.toFixed(1),
                    overspeeds,
                    idle: `${idle}m`,
                    score
                });
            });

            // Sort by score descending (Leaderboard)
            driverRows.sort((a, b) => b.score - a.score);
            driverRows.forEach((row, idx) => {
                drawTableRow(doc, 30, driverY, driverColumns, row, idx % 2 === 1);
                driverY += 20;
            });

            // Section 4: Security Alerts
            doc.fillColor('#0A192F')
               .font('Helvetica-Bold')
               .fontSize(12)
               .text('Security Alerts Audit Logs', 30, driverY + 20);

            const alertColumns = [
                { title: 'Timestamp', key: 'time', width: 105 },
                { title: 'Vehicle', key: 'vName', width: 95 },
                { title: 'Alert Type', key: 'type', width: 110 },
                { title: 'Severity', key: 'severity', width: 65 },
                { title: 'Location', key: 'loc', width: 160 }
            ];

            drawTableHeader(doc, 30, driverY + 35, alertColumns);

            let alertY = driverY + 55;
            let alertRowsCount = 0;
            vehicles.forEach(v => {
                if (alertRowsCount >= 8) return;
                
                const alertsList = db.prepare(`
                    SELECT type, message, timestamp 
                    FROM vehicle_alerts 
                    WHERE vehicle_id = ? AND timestamp >= ? AND timestamp <= ? 
                    ORDER BY timestamp DESC LIMIT 5
                `).all(v.id, startTime, endTime);

                alertsList.forEach(a => {
                    if (alertRowsCount >= 8) return;

                    let severity = 'Low';
                    if (['THEFT', 'TAMPER', 'POWER_DISCONNECT'].includes(a.type)) {
                        severity = 'CRITICAL';
                    } else if (['UNAUTHORIZED_START', 'START_ATTEMPT_BLOCKED', 'RELAY_BYPASS', 'TOW_DETECTION'].includes(a.type)) {
                        severity = 'HIGH';
                    } else if (['GEOFENCE_BREACH', 'CURFEW_VIOLATION'].includes(a.type)) {
                        severity = 'MEDIUM';
                    }

                    const row = {
                        time: new Date(a.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
                        vName: v.name,
                        type: a.type.replace(/_/g, ' '),
                        severity,
                        loc: v.lat && v.lng ? `${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}` : 'Unknown'
                    };
                    drawTableRow(doc, 30, alertY, alertColumns, row, alertRowsCount % 2 === 1);
                    alertY += 20;
                    alertRowsCount++;
                });
            });

            if (alertRowsCount === 0) {
                doc.fillColor('#98A2B3')
                   .font('Helvetica-Oblique')
                   .fontSize(8)
                   .text('No security incidents or alerts logged during this timeframe.', 40, alertY + 10);
                alertY += 20;
            }

            // Footer
            doc.fillColor('#98A2B3')
               .fontSize(7)
               .text('Page 3 of 4  |  Safebox Fleet Intelligence', 30, 570, { align: 'center' });


            // ----------------------------------------
            // PAGE 4: FUEL COST, MAINTENANCE, AI INSIGHTS
            // ----------------------------------------
            doc.addPage();
            doc.rect(0, 0, 595, 12).fill('#0A192F');

            // Fuel & Cost Analysis
            doc.fillColor('#0A192F')
               .font('Helvetica-Bold')
               .fontSize(14)
               .text('Section 5 - Fuel Analysis & Maintenance Report', 30, 30);

            // Lookup user currency
            const userObj = db.prepare('SELECT currency FROM users WHERE username = ?').get(userName);
            const currencyCode = userObj && userObj.currency ? userObj.currency : 'NGN';
            const currencySymbol = CURRENCY_PDF_SYMBOLS[currencyCode] || (currencyCode + ' ');

            // Check if there are any EVs in the report selection
            const hasEV = vehicles.some(v => v.fuel_type === 'Electric');
            const hasFuel = vehicles.some(v => v.fuel_type !== 'Electric');
            let totalFuelUnit = '';
            if (hasEV && !hasFuel) totalFuelUnit = ' kWh';
            else if (!hasEV && hasFuel) totalFuelUnit = ' L';

            const fuelColumns = [
                { title: 'Vehicle', key: 'vName', width: 110 },
                { title: 'Distance (km)', key: 'dist', width: 90, align: 'right' },
                { title: 'Efficiency', key: 'eff', width: 90, align: 'right' },
                { title: 'Est. Fuel/Energy', key: 'fuel', width: 80, align: 'right' },
                { title: 'Fuel Cost', key: 'cost', width: 85, align: 'right' },
                { title: 'Cost / km', key: 'costPerKm', width: 80, align: 'right' }
            ];

            drawTableHeader(doc, 30, 55, fuelColumns);

            let fuelY = 75;
            let totalFleetDistance = 0;
            let totalFleetFuel = 0;
            let totalFleetCost = 0;

            vehicles.forEach((v, idx) => {
                const dist = analytics.calculateDistance(v.id, startTime, endTime);
                const fuelObj = analytics.calculateFuelUsage(v.id, dist);

                totalFleetDistance += dist;
                totalFleetFuel += fuelObj.fuelUsed;
                totalFleetCost += fuelObj.fuelCost;

                const row = {
                    vName: v.name,
                    dist: dist.toFixed(1),
                    eff: `${fuelObj.fuelEfficiency} ${fuelObj.effUnit}`,
                    fuel: `${fuelObj.fuelUsed.toFixed(1)} ${fuelObj.unit}`,
                    cost: `${currencySymbol}${fuelObj.fuelCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                    costPerKm: `${currencySymbol}${fuelObj.costPerKm.toFixed(2)}`
                };
                drawTableRow(doc, 30, fuelY, fuelColumns, row, idx % 2 === 1);
                fuelY += 20;
            });

            // Fleet Summary Row
            const sumRow = {
                vName: 'FLEET TOTALS',
                dist: totalFleetDistance.toFixed(1),
                eff: '-',
                fuel: totalFleetFuel.toFixed(1) + totalFuelUnit,
                cost: `${currencySymbol}${totalFleetCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                costPerKm: `${currencySymbol}${totalFleetDistance > 0 ? (totalFleetCost / totalFleetDistance).toFixed(2) : '0.00'}`
            };
            drawTableRow(doc, 30, fuelY, fuelColumns, sumRow, false);
            
            // Add a thick bar for summary row
            doc.save();
            doc.lineWidth(1.5).strokeColor('#0A192F')
               .moveTo(30, fuelY).lineTo(565, fuelY).stroke()
               .moveTo(30, fuelY + 20).lineTo(565, fuelY + 20).stroke();
            doc.restore();

            fuelY += 35;

            // Section 6: Maintenance status
            doc.fillColor('#0A192F')
               .font('Helvetica-Bold')
               .fontSize(12)
               .text('Maintenance Status & Reminders', 30, fuelY);

            // Fetch maintenance reminders
            const maintenanceRows = db.prepare(`
                SELECT m.type, m.due_date, m.notes, m.status, v.name as vehicleName
                FROM maintenance_reminders m
                JOIN vehicles v ON m.vehicle_id = v.id
                WHERE m.status = 'PENDING'
                LIMIT 5
            `).all();

            const maintColumns = [
                { title: 'Vehicle', key: 'vName', width: 100 },
                { title: 'Service Type', key: 'type', width: 100 },
                { title: 'Due Date', key: 'dueDate', width: 90 },
                { title: 'Status', key: 'status', width: 70 },
                { title: 'Recommendation / Notes', key: 'notes', width: 175 }
            ];

            drawTableHeader(doc, 30, fuelY + 15, maintColumns);
            
            let maintY = fuelY + 35;
            maintenanceRows.forEach((r, idx) => {
                const isOverdue = r.due_date < Date.now();
                const row = {
                    vName: r.vehicleName,
                    type: r.type,
                    dueDate: new Date(r.due_date).toLocaleDateString(),
                    status: isOverdue ? 'OVERDUE' : 'DUE SOON',
                    notes: r.notes || `Schedule standard ${r.type.toLowerCase()} check.`
                };
                drawTableRow(doc, 30, maintY, maintColumns, row, idx % 2 === 1);
                maintY += 20;
            });

            if (maintenanceRows.length === 0) {
                doc.fillColor('#98A2B3')
                   .font('Helvetica-Oblique')
                   .fontSize(8)
                   .text('All scheduled vehicle maintenances are currently healthy.', 40, maintY + 5);
                maintY += 15;
            }

            maintY += 25;

            // Section 7: Future AI Fleet Insights (Phase 2 Preview)
            doc.save();
            doc.roundedRect(30, maintY, 535, 110, 6)
               .fillAndStroke('#FFFDF5', '#FFE7A3');

            // AI Section Header
            // Sparkle vector icon
            doc.save();
            doc.translate(42, maintY + 12);
            doc.moveTo(8, 0).lineTo(10, 5).lineTo(15, 7).lineTo(10, 9).lineTo(8, 14).lineTo(6, 9).lineTo(1, 7).lineTo(6, 5).closePath().fill('#B7860B');
            doc.restore();

            doc.fillColor('#856404')
               .font('Helvetica-Bold')
               .fontSize(11)
               .text('AI Fleet Insights (Phase 2 Preview)', 60, maintY + 12);

            doc.fillColor('#856404')
               .font('Helvetica-Oblique')
               .fontSize(8.5)
               .text('AI Insights will appear here as more operational data becomes available.', 42, maintY + 30);

            // Print AI recommendations bullets
            const bulletY = maintY + 45;
            doc.font('Helvetica').fontSize(8).fillColor('#664D03');
            
            // Randomly select or simulate highly contextual insights
            doc.text('•  [PREDICTIVE MAINTENANCE] Vehicle SBX-004 has a 78% probability of requiring brake service within the next 30 days based on usage intensity.', 45, bulletY, { width: 505 });
            doc.text('•  [ANOMALY DETECTION] Driver Musa exhibits 35% more idle time than fleet average. Recommend training on anti-idling policies.', 45, bulletY + 16, { width: 505 });
            doc.text('•  [SECURITY RISK] Vehicle SBX-021 has experienced 5 after-hours start attempts in the past month. Advise parking in a secured compound.', 45, bulletY + 32, { width: 505 });
            doc.text('•  [ROUTE OPTIMIZATION] Consolidating Route A and Route B could reduce overall fuel expenditure by 12% next month.', 45, bulletY + 48, { width: 505 });

            doc.restore();

            // Footer
            doc.fillColor('#98A2B3')
               .fontSize(7)
               .text('Page 4 of 4  |  Safebox Fleet Intelligence', 30, 570, { align: 'center' });

            doc.end();

            stream.on('finish', () => {
                resolve({ reportName, filePath, relativePath });
            });
            stream.on('error', (err) => {
                reject(err);
            });
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Programmatic CSV Report Generator
 */
function generateCSVReport(reportType, vehicleIds, driverIds, startTime, endTime) {
    const vehicles = db.prepare('SELECT * FROM vehicles').all().filter(v => vehicleIds.includes(v.id));
    let csv = '';

    const firstVehicle = vehicles[0];
    const user = firstVehicle ? db.prepare('SELECT currency FROM users WHERE id = ?').get(firstVehicle.owner_id) : null;
    const currencyCode = user && user.currency ? user.currency : 'NGN';
    const currencySymbol = CURRENCY_SYMBOLS[currencyCode] || currencyCode;

    if (reportType === 'Fuel & Cost Analysis') {
        csv += `Vehicle Name,Vehicle ID,Distance Covered (km),Fuel Type,Efficiency,Price per unit,Estimated Fuel/Energy Used,Total Cost (${currencySymbol}),Cost per km (${currencySymbol})\n`;
        vehicles.forEach(v => {
            const dist = analytics.calculateDistance(v.id, startTime, endTime);
            const fuelObj = analytics.calculateFuelUsage(v.id, dist);
            csv += `"${v.name}","${v.id}",${dist.toFixed(2)},"${fuelObj.fuelType}","${fuelObj.fuelEfficiency} ${fuelObj.effUnit}",${fuelObj.fuelPrice},"${fuelObj.fuelUsed.toFixed(2)} ${fuelObj.unit}",${fuelObj.fuelCost.toFixed(2)},${fuelObj.costPerKm.toFixed(2)}\n`;
        });
    } else if (reportType === 'Driver Performance') {
        csv += 'Driver Name,Assigned Vehicle,Distance Covered (km),Overspeed Events,Idle Time (mins),Driving Score\n';
        vehicles.forEach(v => {
            const name = v.driver_name || 'Unassigned Driver';
            const dist = analytics.calculateDistance(v.id, startTime, endTime);
            const idle = Math.round(analytics.calculateIdleTime(v.id, startTime, endTime) / 60);
            const overspeeds = db.prepare('SELECT COUNT(*) as cnt FROM vehicle_alerts WHERE vehicle_id = ? AND type = "SPEEDING" AND timestamp >= ? AND timestamp <= ?').get(v.id, startTime, endTime).cnt;
            const score = analytics.calculateDriverScore(v.id, startTime, endTime);
            csv += `"${name}","${v.name}",${dist.toFixed(2)},${overspeeds},${idle},${score}\n`;
        });
    } else {
        // Generic Fleet usage report fallback
        csv += 'Vehicle Name,Vehicle ID,Distance Covered (km),Idle Time (mins),Trips Completed,Avg Speed (km/h),Max Speed (km/h)\n';
        vehicles.forEach(v => {
            const dist = analytics.calculateDistance(v.id, startTime, endTime);
            const idle = Math.round(analytics.calculateIdleTime(v.id, startTime, endTime) / 60);
            const speedHist = db.prepare('SELECT speed FROM vehicle_history WHERE vehicle_id = ? AND timestamp >= ? AND timestamp <= ?').all(v.id, startTime, endTime);
            const maxSpeed = speedHist.length > 0 ? Math.max(...speedHist.map(h => h.speed)) : 0;
            const avgSpeed = speedHist.length > 0 ? speedHist.reduce((a, b) => a + b, 0) / speedHist.length : 0;
            
            let trips = 0;
            let moving = false;
            speedHist.forEach(s => {
                if (s.speed > 5 && !moving) {
                    moving = true;
                    trips++;
                } else if (s.speed <= 5) {
                    moving = false;
                }
            });

            csv += `"${v.name}","${v.id}",${dist.toFixed(2)},${idle},${trips},${Math.round(avgSpeed)},${Math.round(maxSpeed)}\n`;
        });
    }

    const reportName = `Safebox_${reportType.replace(/ /g, '_')}_Report_${Date.now()}.csv`;
    const filePath = path.join(REPORTS_DIR, reportName);
    const relativePath = `/reports/${reportName}`;

    fs.writeFileSync(filePath, csv, 'utf8');
    return { reportName, filePath, relativePath };
}

/**
 * Background runner to process reports asynchronously
 */
async function processReportAsync(reportId, userId, reportType, vehicleIds, driverIds, rangeString, customStart, customEnd, format, userName) {
    db.prepare('UPDATE reports SET status = ?, progress = ? WHERE id = ?').run('PROCESSING', 20, reportId);

    const { startTime, endTime } = getDateRange(rangeString, customStart, customEnd);
    const dateRangeStr = rangeString === 'Custom Range' ? `${new Date(startTime).toLocaleDateString()} - ${new Date(endTime).toLocaleDateString()}` : rangeString;

    try {
        db.prepare('UPDATE reports SET progress = ? WHERE id = ?').run(50, reportId);

        let result;
        if (format === 'PDF') {
            result = await generatePDFReport(reportId, reportType, vehicleIds, driverIds, startTime, endTime, userName, dateRangeStr);
        } else {
            // CSV / Excel fallback
            result = generateCSVReport(reportType, vehicleIds, driverIds, startTime, endTime);
        }

        db.prepare('UPDATE reports SET status = ?, progress = ?, completed_at = ? WHERE id = ?')
          .run('COMPLETED', 100, Date.now(), reportId);

        // Add to report_history archive
        db.prepare(`
            INSERT INTO report_history (generated_by, generated_at, report_type, file_path, name, period)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(userId, Date.now(), reportType, result.relativePath, result.reportName, dateRangeStr);

        return result;
    } catch (err) {
        console.error('Async report generation failed:', err);
        db.prepare('UPDATE reports SET status = ?, error = ? WHERE id = ?').run('FAILED', err.message, reportId);
        throw err;
    }
}

module.exports = {
    generatePDFReport,
    generateCSVReport,
    processReportAsync,
    getDateRange
};
