/**
 * esp_bridge.c - Full-duplex non-blocking UART driver for ESP32 bridge.
 *
 * ROOT CAUSE FIX:
 *   The original HAL_UART_Transmit() is a BLOCKING call. While it was sending
 *   the 180-byte JSON payload (~15ms at 115200), if the ESP32 sent a LOCK/UNLOCK
 *   command in that exact window, the hardware triggered an Overrun Error (ORE)
 *   which permanently disabled the RX interrupt — making the STM32 "deaf".
 *
 * SOLUTION:
 *   Both TX and RX now use interrupt-driven ring buffers.
 *   HAL_UART_Transmit_IT() fires byte-by-byte via ISR, never blocking the CPU.
 *   RX and TX operate independently and can never starve each other.
 */

#include "esp_bridge.h"
#include <string.h>

/* ===== RX Ring Buffer (incoming commands from ESP32) ==================== */
static uint8_t           rx_byte;
static uint8_t           rx_buf[ESP_RX_BUFFER_SIZE];
static volatile uint16_t rx_head = 0;
static volatile uint16_t rx_tail = 0;

/* ===== TX Ring Buffer (outgoing JSON to ESP32) ========================== */
#define TX_BUF_SIZE 512
static uint8_t           tx_buf[TX_BUF_SIZE];
static volatile uint16_t tx_head = 0;   /* next byte to transmit */
static volatile uint16_t tx_tail = 0;   /* next free slot        */
static volatile uint8_t  tx_busy = 0;   /* 1 while ISR is sending */
static uint8_t           tx_byte;       /* staging register for IT */

/* ===== Private Helpers ================================================== */

void ESP_RxByteCallback(uint8_t byte)
{
    rx_buf[rx_head] = byte;
    rx_head = (rx_head + 1) % ESP_RX_BUFFER_SIZE;
}

static void prv_KickTx(void)
{
    /* Called from task context — safe because tx_busy is checked atomically */
    if (!tx_busy && tx_head != tx_tail)
    {
        tx_busy = 1;
        tx_byte = tx_buf[tx_head];
        tx_head = (tx_head + 1) % TX_BUF_SIZE;
        HAL_UART_Transmit_IT(&huart3, &tx_byte, 1);
    }
}

static void prv_TxEnqueue(const char *data, uint16_t len)
{
    for (uint16_t i = 0; i < len; i++)
    {
        uint16_t next = (tx_tail + 1) % TX_BUF_SIZE;
        if (next != tx_head) /* never overwrite unread data */
        {
            tx_buf[tx_tail] = (uint8_t)data[i];
            tx_tail = next;
        }
    }
}

static int prv_ReadByte(void)
{
    if (rx_tail == rx_head) return -1;
    uint8_t b = rx_buf[rx_tail];
    rx_tail = (rx_tail + 1) % ESP_RX_BUFFER_SIZE;
    return (int)b;
}

/* ===== HAL ISR Callbacks ================================================ */

/* Called by HAL after each byte is transmitted */
void HAL_UART_TxCpltCallback(UART_HandleTypeDef *huart)
{
    if (huart->Instance == USART3)
    {
        if (tx_head != tx_tail)
        {
            /* More bytes waiting — send next one immediately */
            tx_byte = tx_buf[tx_head];
            tx_head = (tx_head + 1) % TX_BUF_SIZE;
            HAL_UART_Transmit_IT(&huart3, &tx_byte, 1);
        }
        else
        {
            tx_busy = 0; /* TX queue empty */
        }
    }
}

/* ===== Public API ======================================================= */

void ESP_Init(void)
{
    __HAL_UART_CLEAR_OREFLAG(&huart3);
    /* Enable RX Interrupt manually bypassing HAL */
    __HAL_UART_ENABLE_IT(&huart3, UART_IT_RXNE);
}

void ESP_PublishMQTT(const char *payload)
{
    /* Non-blocking: enqueue into TX ring buffer and let the ISR handle it */
    prv_TxEnqueue(payload, strlen(payload));
    prv_TxEnqueue("\n", 1);
    prv_KickTx();
}

void ESP_Process(void)
{
    static char    line[64];
    static uint8_t idx = 0;

    int c;
    while ((c = prv_ReadByte()) >= 0)
    {
        char ch = (char)c;
        if (ch == '\n' || idx >= sizeof(line) - 1)
        {
            line[idx] = '\0';

            if (strstr(line, "UNLOCK") != NULL)
            {
                ESP_OnCommandReceived("UNLOCK");
            }
            else if (strstr(line, "LOCK") != NULL)
            {
                ESP_OnCommandReceived("LOCK");
            }

            idx = 0;
            memset(line, 0, sizeof(line));
        }
        else if (ch != '\r')
        {
            line[idx++] = ch;
        }
    }
}

__attribute__((weak)) void ESP_OnCommandReceived(const char *command)
{
    (void)command;
}
