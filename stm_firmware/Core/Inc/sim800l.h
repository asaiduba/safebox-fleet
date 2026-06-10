#ifndef INC_SIM800L_H_
#define INC_SIM800L_H_

#include "stm32f1xx_hal.h"
#include <stdbool.h>
#include <stdint.h>

/* -----------------------------------------------------------------------
 * SIM800L Driver — ATCommand / MQTT over CMQTT
 * USART3 (PB10=TX, PB11=RX) is used — avoids ST-Link VCP conflict on PA9/PA10.
 * ---------------------------------------------------------------------- */

extern UART_HandleTypeDef huart3;

/* Size of the receive ring-buffer (must be power of 2) */
#define SIM800L_RX_BUFFER_SIZE  512

/* Maximum AT response wait time (ms) */
#define SIM800L_DEFAULT_TIMEOUT 5000
#define SIM800L_MQTT_TIMEOUT    15000

/* MQTT broker settings */
#define MQTT_BROKER_HOST  "broker.emqx.io"
#define MQTT_BROKER_PORT  1883
#define MQTT_CLIENT_ID    "STM32_SAFEBOX_002"

/* Topic definitions — must match what the backend subscribes to */
#define MQTT_TOPIC_STATUS  "/device/SAFEBOX_002/status"
#define MQTT_TOPIC_COMMAND "/device/SAFEBOX_002/command"

/* Device ID embedded in JSON payload */
#define DEVICE_ID         "SAFEBOX_002"

/* ---- Public API -------------------------------------------------------- */

/**
 * @brief  Initialise the SIM800L: wake, check AT, wait for network,
 *         configure GPRS and connect to MQTT broker.
 * @retval true on success, false on failure
 */
bool SIM800L_Init(void);

/**
 * @brief  Check that GSM network registration is valid (AT+CREG?).
 * @retval true if registered on home or roaming network
 */
bool SIM800L_CheckNetwork(void);

/**
 * @brief  (Re-)connect to the MQTT broker using AT+CMQTTCONN.
 *         Call after network loss or cold start.
 * @retval true on success
 */
bool SIM800L_ConnectMQTT(void);

/**
 * @brief  Publish a payload string to a topic.
 * @param  topic   Null-terminated topic string
 * @param  payload Null-terminated JSON payload
 * @retval true on success
 */
bool SIM800L_PublishMQTT(const char *topic, const char *payload);

/**
 * @brief  Subscribe to the command topic.
 *         Must be called once after ConnectMQTT.
 */
bool SIM800L_Subscribe(void);

/**
 * @brief  Call this periodically from the GSM task to read incoming data
 *         and fire the command callback if a LOCK/UNLOCK arrives.
 */
void SIM800L_Process(void);

/**
 * @brief  Check whether the MQTT session is currently alive.
 * @retval true if connected
 */
bool SIM800L_IsMQTTConnected(void);

/**
 * @brief  Callback invoked when a LOCK or UNLOCK command arrives via MQTT.
 *         Implemented in freertos.c (weak default provided).
 * @param  command  "LOCK" or "UNLOCK"
 */
void SIM800L_OnCommandReceived(const char *command);

#endif /* INC_SIM800L_H_ */
