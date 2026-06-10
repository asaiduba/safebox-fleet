/**
 ******************************************************************************
 * @file    sim800l.c
 * @brief   SIM800L GSM/GPRS driver with MQTT over AT+CMQTT commands.
 *
 * UART mapping (configured in STM32CubeIDE .ioc):
 *   USART3  TX -> PB10   RX -> PB11   Baud: 115200   (SIM800L)
 *
 * SIM800L POWER:
 *   - Supply voltage: 3.4V – 4.4V  (do NOT use 3.3V STM32 pin directly)
 *   - Use a dedicated LiPo cell or a high-current DC converter rated >= 2A
 *   - Connect SIM800L GND to STM32 GND (common ground is mandatory)
 *
 * AT+CMQTT command set (supported by SIM800L firmware R14.18 and newer):
 *   AT+CMQTTSTART           — Start MQTT service
 *   AT+CMQTTACCQ            — Acquire a client
 *   AT+CMQTTCONNECT         — Connect to broker
 *   AT+CMQTTSUB             — Subscribe to topic
 *   AT+CMQTTTOPIC / PAYLOAD — Set topic+payload before publish
 *   AT+CMQTTPUB             — Publish
 *   AT+CMQTTDISC            — Disconnect
 *   +CMQTTRXSTART / ...END  — Incoming message URC
 ******************************************************************************
 */

#include "sim800l.h"
#include <string.h>
#include <stdio.h>
#include <stdlib.h>

/* ---- Private receive buffer ------------------------------------------- */
static uint8_t  rx_byte;                          /* Single-byte DMA target    */
static uint8_t  rx_buf[SIM800L_RX_BUFFER_SIZE];   /* Circular receive store    */
static uint16_t rx_head = 0;                       /* Write index               */
static uint16_t rx_tail = 0;                       /* Read index                */

static bool mqtt_connected = false;
static bool mqtt_started   = false;

/* ---- Private helpers --------------------------------------------------- */

/** @brief Kick off single-byte interrupt-driven reception. */
static void prv_StartRx(void)
{
    HAL_UART_Receive_IT(&huart3, &rx_byte, 1);
}

/**
 * @brief HAL callback for every byte received on UART1.
 *        Store in ring-buffer; DO NOT call HAL functions that block.
 */
void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart)
{
    if (huart->Instance == USART3)
    {
        rx_buf[rx_head] = rx_byte;
        rx_head = (rx_head + 1) % SIM800L_RX_BUFFER_SIZE;
        prv_StartRx();   /* re-arm */
    }
}

/** @brief Read one byte from ring-buffer. Returns -1 if empty. */
static int prv_ReadByte(void)
{
    if (rx_tail == rx_head) return -1;
    uint8_t b = rx_buf[rx_tail];
    rx_tail = (rx_tail + 1) % SIM800L_RX_BUFFER_SIZE;
    return (int)b;
}

/** @brief Send a null-terminated AT command string over UART1. */
static void prv_Send(const char *cmd)
{
    HAL_UART_Transmit(&huart3, (uint8_t *)cmd, strlen(cmd), 1000);
}

/**
 * @brief Wait up to `timeout_ms` for `expected` substring in the receive
 *        ring-buffer.  Fills `out` (if not NULL) with everything read.
 * @retval true if `expected` was found before timeout
 */
static bool prv_WaitFor(const char *expected, uint32_t timeout_ms, char *out, uint16_t out_size)
{
    char   line[256] = {0};
    uint16_t idx      = 0;
    uint32_t deadline = HAL_GetTick() + timeout_ms;

    while (HAL_GetTick() < deadline)
    {
        int c = prv_ReadByte();
        if (c < 0) { HAL_Delay(1); continue; }

        if ((char)c == '\n' || idx >= sizeof(line) - 1)
        {
            line[idx] = '\0';
            if (out && idx > 0)
            {
                /* Append line to out buffer */
                uint16_t rem = out_size - strlen(out) - 1;
                strncat(out, line, rem);
                strncat(out, "\n", 1);
            }
            if (strstr(line, expected)) return true;
            idx = 0;
            memset(line, 0, sizeof(line));
        }
        else if ((char)c != '\r')
        {
            line[idx++] = (char)c;
        }
    }
    return false;
}

/** @brief Send command and wait for OK within timeout. */
static bool prv_CmdOK(const char *cmd, uint32_t timeout_ms)
{
    prv_Send(cmd);
    return prv_WaitFor("OK", timeout_ms, NULL, 0);
}

/* ---- Network helpers -------------------------------------------------- */

/** @brief Activate GPRS bearer (APN: internet — most carriers). */
static bool prv_ActivateGPRS(void)
{
    /* Configure bearer */
    if (!prv_CmdOK("AT+SAPBR=3,1,\"Contype\",\"GPRS\"\r\n", 5000)) return false;
    if (!prv_CmdOK("AT+SAPBR=3,1,\"APN\",\"internet\"\r\n",  5000)) return false;
    /* Open bearer — may already be open, so accept either OK or ERROR */
    prv_Send("AT+SAPBR=1,1\r\n");
    prv_WaitFor("OK", 10000, NULL, 0);   /* ignore result */
    return true;
}

/* ======================================================================
 * Public API — Implementation
 * ====================================================================== */

bool SIM800L_Init(void)
{
    /* Start interrupt-driven byte reception */
    prv_StartRx();

    HAL_Delay(3000); /* Give SIM800L time to boot */

    /* Basic alive check — retry 5x */
    for (int i = 0; i < 5; i++)
    {
        if (prv_CmdOK("AT\r\n", 2000)) break;
        if (i == 4) return false;
        HAL_Delay(1000);
    }

    /* Echo off */
    prv_CmdOK("ATE0\r\n", 2000);

    /* Wait for GSM network registration */
    if (!SIM800L_CheckNetwork()) return false;

    /* Activate GPRS */
    if (!prv_ActivateGPRS()) return false;

    /* Start MQTT service */
    if (!prv_CmdOK("AT+CMQTTSTART\r\n", SIM800L_MQTT_TIMEOUT))
    {
        /* Maybe already started — try to continue */
    }
    mqtt_started = true;

    /* Acquire client slot 0 */
    char acq_cmd[80];
    snprintf(acq_cmd, sizeof(acq_cmd),
             "AT+CMQTTACCQ=0,\"%s\"\r\n", MQTT_CLIENT_ID);
    prv_CmdOK(acq_cmd, 5000);

    /* Connect to broker */
    return SIM800L_ConnectMQTT();
}

bool SIM800L_CheckNetwork(void)
{
    /* Poll AT+CREG? up to 60 seconds */
    uint32_t deadline = HAL_GetTick() + 60000;
    while (HAL_GetTick() < deadline)
    {
        prv_Send("AT+CREG?\r\n");
        char resp[128] = {0};
        if (prv_WaitFor("+CREG:", 3000, resp, sizeof(resp)))
        {
            /* +CREG: 0,1 = home  0,5 = roaming */
            if (strstr(resp, ",1") || strstr(resp, ",5"))
                return true;
        }
        HAL_Delay(2000);
    }
    return false;
}

bool SIM800L_ConnectMQTT(void)
{
    char conn_cmd[128];
    snprintf(conn_cmd, sizeof(conn_cmd),
             "AT+CMQTTCONNECT=0,\"tcp://%s:%d\",60,1\r\n",
             MQTT_BROKER_HOST, MQTT_BROKER_PORT);
    prv_Send(conn_cmd);

    /* Wait for +CMQTTCONNECT: 0,0  (error code 0 = success) */
    char resp[128] = {0};
    if (prv_WaitFor("+CMQTTCONNECT:", SIM800L_MQTT_TIMEOUT, resp, sizeof(resp)))
    {
        if (strstr(resp, "0,0"))
        {
            mqtt_connected = true;
            SIM800L_Subscribe();
            return true;
        }
    }
    mqtt_connected = false;
    return false;
}

bool SIM800L_Subscribe(void)
{
    /* Set topic for subscription */
    char sub_cmd[128];
    snprintf(sub_cmd, sizeof(sub_cmd),
             "AT+CMQTTSUB=0,\"%s\",%u,1\r\n",
             MQTT_TOPIC_COMMAND, (unsigned)strlen(MQTT_TOPIC_COMMAND));
    prv_Send(sub_cmd);
    return prv_WaitFor("OK", 5000, NULL, 0);
}

bool SIM800L_PublishMQTT(const char *topic, const char *payload)
{
    if (!mqtt_connected) return false;

    uint16_t topic_len   = strlen(topic);
    uint16_t payload_len = strlen(payload);

    char cmd[64];

    /* Step 1: Set topic */
    snprintf(cmd, sizeof(cmd), "AT+CMQTTTOPIC=0,%u\r\n", topic_len);
    prv_Send(cmd);
    if (!prv_WaitFor(">", 3000, NULL, 0)) return false;
    prv_Send(topic);

    /* Step 2: Set payload */
    snprintf(cmd, sizeof(cmd), "AT+CMQTTPAYLOAD=0,%u\r\n", payload_len);
    prv_Send(cmd);
    if (!prv_WaitFor(">", 3000, NULL, 0)) return false;
    prv_Send(payload);

    /* Step 3: Publish (QoS 0, retain 0) */
    prv_Send("AT+CMQTTPUB=0,0,60\r\n");
    char resp[64] = {0};
    if (prv_WaitFor("+CMQTTPUB:", 5000, resp, sizeof(resp)))
    {
        return strstr(resp, "0,0") != NULL; /* error code 0 = OK */
    }
    return false;
}

bool SIM800L_IsMQTTConnected(void)
{
    return mqtt_connected;
}

void SIM800L_Process(void)
{
    /*
     * Drain the ring-buffer looking for unsolicited result codes (URCs)
     * from the SIM800L related to incoming MQTT messages.
     *
     * Incoming message format:
     *   +CMQTTRXSTART: 0,<topic_len>,<payload_len>
     *   +CMQTTRXTOPIC: 0,<topic_len>
     *   <topic bytes>
     *   +CMQTTRXPAYLOAD: 0,<payload_len>
     *   <payload bytes>
     *   +CMQTTRXEND: 0
     */
    static char  urc_buf[256];
    static uint8_t urc_idx = 0;

    int c;
    while ((c = prv_ReadByte()) >= 0)
    {
        if ((char)c == '\n' || urc_idx >= sizeof(urc_buf) - 1)
        {
            urc_buf[urc_idx] = '\0';

            /* Check for disconnect URC */
            if (strstr(urc_buf, "+CMQTTNONET") ||
                strstr(urc_buf, "+CMQTTLOST"))
            {
                mqtt_connected = false;
            }

            /* Check for received payload URC */
            if (strstr(urc_buf, "+CMQTTRXPAYLOAD:"))
            {
                /* The next chunk in the buffer is the payload.
                 * Read until we see +CMQTTRXEND */
                char payload[128] = {0};
                uint8_t pi = 0;
                uint32_t t = HAL_GetTick();
                while (HAL_GetTick() - t < 3000 && pi < sizeof(payload) - 1)
                {
                    int pc = prv_ReadByte();
                    if (pc < 0) { HAL_Delay(1); continue; }
                    payload[pi++] = (char)pc;
                    payload[pi] = '\0';
                    if (strstr(payload, "+CMQTTRXEND")) break;
                }
                /* Look for "LOCK" or "UNLOCK" in payload */
                if (strstr(payload, "UNLOCK"))
                    SIM800L_OnCommandReceived("UNLOCK");
                else if (strstr(payload, "LOCK"))
                    SIM800L_OnCommandReceived("LOCK");
            }

            urc_idx = 0;
            memset(urc_buf, 0, sizeof(urc_buf));
        }
        else if ((char)c != '\r')
        {
            urc_buf[urc_idx++] = (char)c;
        }
    }
}

/* Weak default — override in freertos.c */
__attribute__((weak)) void SIM800L_OnCommandReceived(const char *command)
{
    (void)command;
}
