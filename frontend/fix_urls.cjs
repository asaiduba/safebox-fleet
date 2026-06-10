const fs = require('fs');
const files = ['src/App.jsx', 'src/Auth.jsx', 'src/AnalyticsDashboard.jsx', 'src/Leaderboard.jsx'];

files.forEach(f => {
    if (!fs.existsSync(f)) return;
    let data = fs.readFileSync(f, 'utf8');
    if (!data.includes('API_BASE')) {
        data = `const API_BASE = import.meta.env.VITE_API_URL || '';\n` + data;
        data = data.replace(/'http:\/\/localhost:3000'/g, 'API_BASE');
        data = data.replace(/`http:\/\/localhost:3000/g, '`${API_BASE}');
        fs.writeFileSync(f, data);
        console.log('Updated ' + f);
    }
});
