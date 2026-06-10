/**
 ******************************************************************************
 * @file    usart.c
 * @brief   UART1/UART2 init stubs + DMA IDLE-line callback for GPS.
 *
 * The actual peripheral init (MX_USART1_UART_Init, MX_USART2_UART_Init,
 * MX_DMA_Init) lives in main.c / the CubeIDE-generated code — DO NOT
 * regenerate from CubeMX without merging user sections.
 *
 * What this file owns:
 *   - The global GPS DMA receive buffer
 *   - HAL_UARTEx_RxEventCallback — called every time the GPS IDLE fires
 ******************************************************************************
 */

/* Includes ------------------------------------------------------------------*/
#include "main.h"
#include "bn220.h"

/* USER CODE BEGIN 0 */
extern UART_HandleTypeDef huart2;

/**
 * BN-220 GPS DMA receive buffer.
 * DMA writes here in the background; the callback forwards the chunk to
 * BN220_ParseNMEA() which is safe to call from an ISR context.
 */
uint8_t gps_rx_buffer[GPS_DMA_RX_BUFFER_SIZE];
/* USER CODE END 0 */

/* USER CODE BEGIN 1 */

/**
 * @brief  UART Rx Event Callback — triggered by DMA IDLE line detection.
 *
 *         Called automatically by the HAL when either:
 *           a) The DMA buffer fills completely, OR
 *           b) An IDLE event occurs on the UART RX line (end of NMEA burst)
 *
 *         This is the correct non-blocking approach for variable-length
 *         frames like NMEA sentences.
 *
 * @param  huart  Pointer to UART handle
 * @param  Size   Number of bytes received into the buffer since last call
 */
void HAL_UARTEx_RxEventCallback(UART_HandleTypeDef *huart, uint16_t Size)
{
    if (huart->Instance == USART2) /* GPS UART */
    {
        /* Forward raw bytes to the NMEA parser */
        BN220_ParseNMEA(gps_rx_buffer, Size);

        /* Restart DMA reception — circular mode keeps data flowing */
        HAL_UARTEx_ReceiveToIdle_DMA(&huart2, gps_rx_buffer,
                                      GPS_DMA_RX_BUFFER_SIZE);

        /* Suppress the half-transfer interrupt (we only want IDLE events) */
        __HAL_DMA_DISABLE_IT(huart2.hdmarx, DMA_IT_HT);
    }
}

/* USER CODE END 1 */
