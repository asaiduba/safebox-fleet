#ifndef INC_BN220_H_
#define INC_BN220_H_

#include "stm32f1xx_hal.h"
#include <stdbool.h>
#include <stdint.h>

/* -----------------------------------------------------------------------
 * BN-220 GPS Driver (NMEA over UART2 + DMA)
 * UART2 (huart2) with DMA is used for GPS data reception.
 * ---------------------------------------------------------------------- */

extern UART_HandleTypeDef huart2;

/* GPS DMA receive buffer (defined in usart.c) */
#define GPS_DMA_RX_BUFFER_SIZE  256

/* Parsed GPS data structure */
typedef struct {
    double  latitude;   /* Decimal degrees, positive = N */
    double  longitude;  /* Decimal degrees, positive = E */
    float   speed_kmh;  /* Speed over ground in km/h */
    bool    isValid;    /* True when a valid fix is available */
} GPS_Data_t;

/* ---- Public API -------------------------------------------------------- */

/**
 * @brief  Start DMA circular reception on UART2.
 *         Call once from GPS task before entering the infinite loop.
 */
void BN220_Init(void);

/**
 * @brief  Parse a chunk of raw NMEA bytes received via DMA.
 *         Call from HAL_UARTEx_RxEventCallback with the received buffer.
 * @param  buffer  Pointer to DMA receive buffer
 * @param  length  Number of bytes available
 */
void BN220_ParseNMEA(const uint8_t *buffer, uint16_t length);

/**
 * @brief  Get the most recently parsed GPS fix (thread-safe copy).
 * @retval GPS_Data_t snapshot
 */
GPS_Data_t BN220_GetLatestData(void);

/**
 * @brief  Returns true if at least one valid GPRMC sentence has been parsed.
 */
bool BN220_HasFix(void);

#endif /* INC_BN220_H_ */
