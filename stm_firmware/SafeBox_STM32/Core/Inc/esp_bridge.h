#ifndef INC_ESP_BRIDGE_H_
#define INC_ESP_BRIDGE_H_

#include "stm32f1xx_hal.h"
#include <stdbool.h>
#include <stdint.h>

/* USART3 is used to communicate with the ESP32 bridge */
extern UART_HandleTypeDef huart3;

#define ESP_RX_BUFFER_SIZE  128

/**
 * @brief Initialize the serial driver for ESP Bridge.
 */
void ESP_Init(void);

/**
 * @brief Publish JSON payload over UART to the ESP32 bridge.
 * @param payload Null-terminated JSON string.
 */
void ESP_PublishMQTT(const char *payload);

/**
 * @brief Call periodically to process incoming strings from the ESP32.
 */
void ESP_Process(void);

/**
 * @brief Callback invoked when a command is received from the ESP32.
 *        Implemented in freertos.c
 */
void ESP_OnCommandReceived(const char *command);

#endif /* INC_ESP_BRIDGE_H_ */
