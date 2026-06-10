/**
 ******************************************************************************
 * @file    bn220.c
 * @brief   BN-220 GPS NMEA parser driven by UART2 + DMA (IDLE-line detection).
 *
 * UART mapping (configured in STM32CubeIDE .ioc):
 *   USART2  TX -> PA2   RX -> PA3   Baud: 9600   (BN-220 GPS)
 *   DMA1 Stream5 linked to USART2_RX in Normal mode (restarted in callback)
 *
 * The BN-220 outputs NMEA 0183 sentences at 9600 baud.
 * We parse:  $GPRMC — position, speed, validity
 *            $GPGGA — altitude, fix quality (not used in payload but parsed)
 *
 * Thread safety: latitude/longitude/speed are updated under a critical section
 * so the GSM task can safely read them at any time.
 ******************************************************************************
 */

#include "bn220.h"
#include <string.h>
#include <stdlib.h>
#include <math.h>

/* ---- Private state ----------------------------------------------------- */

static volatile GPS_Data_t g_gps = {
    .latitude  = -1.9357331,   /* Default: Kigali area (same as old ESP32) */
    .longitude = 30.1578407,
    .speed_kmh = 0.0f,
    .isValid   = false
};

/* ---- NMEA helpers ------------------------------------------------------- */

/**
 * @brief  Convert NMEA lat/lon field (DDDMM.MMMM) to decimal degrees.
 * @param  field      The raw NMEA field string
 * @param  hemisphere 'N'/'S' or 'E'/'W'
 */
static double prv_NMEAToDecimal(const char *field, char hemisphere)
{
    if (!field || field[0] == '\0') return 0.0;

    double raw = atof(field);
    int    deg = (int)(raw / 100);
    double min = raw - (deg * 100.0);
    double dec = deg + (min / 60.0);

    if (hemisphere == 'S' || hemisphere == 'W') dec = -dec;
    return dec;
}

/**
 * @brief  Verify NMEA checksum.
 *         NMEA format: $<data>*<2-digit-hex-checksum>\r\n
 * @retval true if checksum matches
 */
static bool prv_VerifyChecksum(const char *sentence)
{
    const char *star = strchr(sentence, '*');
    if (!star || strlen(star) < 3) return false;

    uint8_t calc = 0;
    /* XOR all bytes between $ and * (exclusive) */
    for (const char *p = sentence + 1; p < star; p++)
        calc ^= (uint8_t)(*p);

    uint8_t expected = (uint8_t)strtol(star + 1, NULL, 16);
    return calc == expected;
}

/**
 * @brief  Extract the Nth comma-delimited field from an NMEA sentence.
 * @param  sentence   Full NMEA sentence string
 * @param  field_num  0-based field index (0 = sentence type)
 * @param  out        Output buffer
 * @param  out_size   Size of output buffer
 */
static void prv_GetField(const char *sentence, uint8_t field_num,
                          char *out, uint8_t out_size)
{
    uint8_t f = 0;
    const char *p = sentence;
    out[0] = '\0';

    while (*p)
    {
        if (f == field_num)
        {
            uint8_t i = 0;
            while (*p && *p != ',' && *p != '*' && i < out_size - 1)
                out[i++] = *p++;
            out[i] = '\0';
            return;
        }
        if (*p == ',') f++;
        p++;
    }
}

/**
 * @brief  Parse a $GPRMC sentence and update g_gps.
 *
 *  $GPRMC,HHMMSS.ss,A,LLLL.LL,a,YYYYY.YY,a,x.x,x.x,DDMMYY,x.x,a*hh
 *  Field 0 = $GPRMC
 *  Field 2 = Status (A=active/valid  V=void)
 *  Field 3 = Latitude   Field 4 = N/S
 *  Field 5 = Longitude  Field 6 = E/W
 *  Field 7 = Speed over ground (knots)
 */
static void prv_ParseGPRMC(const char *sentence)
{
    if (!prv_VerifyChecksum(sentence)) return;

    char status[4]  = {0};
    char lat[16]    = {0};
    char lat_ns[4]  = {0};
    char lon[16]    = {0};
    char lon_ew[4]  = {0};
    char spd[12]    = {0};

    prv_GetField(sentence, 2, status, sizeof(status));
    if (status[0] != 'A') 
    { 
        /* Void fix — keep old coordinates, mark invalid */
        __disable_irq();
        g_gps.isValid = false;
        __enable_irq();
        return; 
    }

    prv_GetField(sentence, 3, lat,   sizeof(lat));
    prv_GetField(sentence, 4, lat_ns, sizeof(lat_ns));
    prv_GetField(sentence, 5, lon,   sizeof(lon));
    prv_GetField(sentence, 6, lon_ew, sizeof(lon_ew));
    prv_GetField(sentence, 7, spd,   sizeof(spd));

    double  latitude  = prv_NMEAToDecimal(lat, lat_ns[0]);
    double  longitude = prv_NMEAToDecimal(lon, lon_ew[0]);
    float   speed_kn  = (float)atof(spd);
    float   speed_kmh = speed_kn * 1.852f;

    /* Update shared state — critical section protects double writes */
    __disable_irq();
    g_gps.latitude  = latitude;
    g_gps.longitude = longitude;
    g_gps.speed_kmh = speed_kmh;
    g_gps.isValid   = true;
    __enable_irq();
}

/* ======================================================================
 * Public API — Implementation
 * ====================================================================== */

void BN220_Init(void)
{
    /* DMA reception is started in freertos.c StartGpsTask — nothing extra here */
}

void BN220_ParseNMEA(const uint8_t *buffer, uint16_t length)
{
    /*
     * The DMA buffer may contain multiple NMEA sentences concatenated.
     * We scan for '$' start and '\n' end, then dispatch each sentence.
     */
    static char sentence[128];
    static uint8_t si = 0;

    for (uint16_t i = 0; i < length; i++)
    {
        char c = (char)buffer[i];

        if (c == '$')
        {
            /* New sentence starts — reset buffer */
            si = 0;
            sentence[si++] = c;
        }
        else if (c == '\n' && si > 0)
        {
            sentence[si] = '\0';

            /* Dispatch based on sentence type */
            if (strncmp(sentence, "$GPRMC", 6) == 0 ||
                strncmp(sentence, "$GNRMC", 6) == 0)
            {
                prv_ParseGPRMC(sentence);
            }
            /* Additional sentence types ($GPGGA, $GPVTG) can be added here */

            si = 0;
        }
        else if (si > 0 && si < sizeof(sentence) - 1)
        {
            sentence[si++] = c;
        }
    }
}

GPS_Data_t BN220_GetLatestData(void)
{
    /* Atomic copy under critical section */
    GPS_Data_t copy;
    __disable_irq();
    copy = g_gps;
    __enable_irq();
    return copy;
}

bool BN220_HasFix(void)
{
    return g_gps.isValid;
}
