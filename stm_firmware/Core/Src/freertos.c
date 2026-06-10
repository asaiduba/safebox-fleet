/**
 ******************************************************************************
 * @file    freertos.c
 * @brief   FreeRTOS task implementations — the main application logic.
 *
 * Tasks:
 *   StartGpsTask   — keeps GPS DMA alive, GPS data is parsed in usart.c ISR
 *   StartGsmTask   — init SIM800L, publish telemetry every 2 s, handle cmds
 *   StartRfTask    — process RF remote press events, control relay
 *
 * Shared state (protected by gsm_mutex):
 *   g_isLocked     — current physical lock state (relay)
 *   g_cloudLocked  — last LOCK/UNLOCK from web cloud
 *   g_battery      — simulated battery %
 *   g_fuel         — simulated fuel %
 *
 * Pin assignments (must match .ioc / main.h):
 *   RELAY  -> PA5  (active HIGH = engine enabled)
 *   RF RX  -> PA4  (EXTI interrupt)
 *   USART1 -> PA9/PA10 (SIM800L)
 *   USART2 -> PA2/PA3  (BN-220 GPS)
 ******************************************************************************
 */

/* Includes ------------------------------------------------------------------*/
#include "FreeRTOS.h"
#include "task.h"
#include "cmsis_os.h"
#include "main.h"
#include "sim800l.h"
#include "bn220.h"
#include "rf433.h"
#include <string.h>
#include <stdio.h>
#include <stdlib.h>

/* ---- Extern UART handles (defined in main.c) --------------------------- */
extern UART_HandleTypeDef huart1; /* GSM  */
extern UART_HandleTypeDef huart2; /* GPS  */

/* ---- External GPS DMA buffer (defined in usart.c) --------------------- */
extern uint8_t gps_rx_buffer[GPS_DMA_RX_BUFFER_SIZE];

/* =========================================================================
 * Shared application state
 * ========================================================================= */
static volatile bool    g_isLocked    = true;   /* Default: locked at boot */
static volatile bool    g_cloudLocked = false;
static volatile float   g_battery     = 100.0f;
static volatile float   g_fuel        = 100.0f;

/* FreeRTOS mutex to guard shared state during JSON build + publish */
static osMutexId_t gsm_mutex;

/* =========================================================================
 * FreeRTOS task handles
 * ========================================================================= */
osThreadId_t gpsTaskHandle;
osThreadId_t gsmTaskHandle;
osThreadId_t rfTaskHandle;

/* =========================================================================
 * Private helpers
 * ========================================================================= */

/** @brief Write relay GPIO to reflect current g_isLocked value. */
static void prv_UpdateRelay(void)
{
    /* Relay module: HIGH = energised = engine ENABLED (not locked) */
    GPIO_PinState state = g_isLocked ? GPIO_PIN_RESET : GPIO_PIN_SET;
    HAL_GPIO_WritePin(RELAY_PIN_GPIO_Port, RELAY_PIN_Pin, state);
}

/**
 * @brief  Build the MQTT JSON payload and publish it.
 *         Must be called with gsm_mutex held.
 */
static void prv_PublishStatus(void)
{
    GPS_Data_t gps = BN220_GetLatestData();

    char payload[256];
    snprintf(payload, sizeof(payload),
             "{"
             "\"deviceId\":\"%s\","
             "\"lat\":%.6f,"
             "\"lng\":%.6f,"
             "\"speed\":%.1f,"
             "\"locked\":%s,"
             "\"cloudLocked\":%s,"
             "\"battery\":%d,"
             "\"fuel\":%d"
             "}",
             DEVICE_ID,
             gps.latitude,
             gps.longitude,
             (double)gps.speed_kmh,
             g_isLocked    ? "true" : "false",
             g_cloudLocked ? "true" : "false",
             (int)g_battery,
             (int)g_fuel);

    SIM800L_PublishMQTT(MQTT_TOPIC_STATUS, payload);
}

/**
 * @brief  Simulate slight battery/fuel drain — called every publish cycle.
 *         Mirrors the ESP32 simulateVehicle() behaviour.
 */
static void prv_SimulateVehicle(void)
{
    GPS_Data_t gps = BN220_GetLatestData();

    if (!g_isLocked && gps.speed_kmh > 0.0f)
        g_fuel -= 0.1f;

    if (g_fuel < 5.0f)  g_fuel   = 100.0f;

    g_battery -= 0.05f;
    if (g_battery < 10.0f) g_battery = 100.0f;
}

/* =========================================================================
 * SIM800L_OnCommandReceived — override from sim800l.c weak stub
 * Called from GSM task context when a LOCK/UNLOCK message arrives.
 * ========================================================================= */
void SIM800L_OnCommandReceived(const char *command)
{
    if (strstr(command, "UNLOCK"))
    {
        g_cloudLocked = false;
        g_isLocked    = false;
    }
    else /* LOCK */
    {
        g_cloudLocked = true;
        g_isLocked    = true;
    }
    prv_UpdateRelay();
    /* Publish state immediately so the dashboard updates without waiting 2 s */
    prv_PublishStatus();
}

/* =========================================================================
 * RTOS Initialisation (called from main.c after peripheral inits)
 * ========================================================================= */
void MX_FREERTOS_Init(void)
{
    /* Create mutex */
    gsm_mutex = osMutexNew(NULL);

    /* GPS task — high priority so DMA restarts are not delayed */
    const osThreadAttr_t gpsAttr = {
        .name       = "gpsTask",
        .stack_size = 512 * 4,
        .priority   = osPriorityAboveNormal,
    };
    gpsTaskHandle = osThreadNew(StartGpsTask, NULL, &gpsAttr);

    /* GSM/MQTT task */
    const osThreadAttr_t gsmAttr = {
        .name       = "gsmTask",
        .stack_size = 1024 * 4,   /* Larger stack: AT commands build strings */
        .priority   = osPriorityNormal,
    };
    gsmTaskHandle = osThreadNew(StartGsmTask, NULL, &gsmAttr);

    /* RF / relay task */
    const osThreadAttr_t rfAttr = {
        .name       = "rfTask",
        .stack_size = 256 * 4,
        .priority   = osPriorityNormal,
    };
    rfTaskHandle = osThreadNew(StartRfTask, NULL, &rfAttr);
}

/* =========================================================================
 * Task: GPS
 * ========================================================================= */
void StartGpsTask(void *argument)
{
    (void)argument;

    /* Kick off DMA reception — IDLE callback in usart.c does the rest */
    HAL_UARTEx_ReceiveToIdle_DMA(&huart2, gps_rx_buffer, GPS_DMA_RX_BUFFER_SIZE);
    /* Suppress half-transfer interrupt — we only want IDLE events */
    __HAL_DMA_DISABLE_IT(huart2.hdmarx, DMA_IT_HT);

    for (;;)
    {
        /*
         * GPS data arrives via DMA ISR → BN220_ParseNMEA().
         * This task just needs to stay alive and yield.
         * If the DMA stalls (GPS disconnected), restart it.
         */
        if (huart2.RxState == HAL_UART_STATE_READY)
        {
            HAL_UARTEx_ReceiveToIdle_DMA(&huart2, gps_rx_buffer,
                                          GPS_DMA_RX_BUFFER_SIZE);
            __HAL_DMA_DISABLE_IT(huart2.hdmarx, DMA_IT_HT);
        }
        osDelay(1000);
    }
}

/* =========================================================================
 * Task: GSM / MQTT
 * ========================================================================= */
void StartGsmTask(void *argument)
{
    (void)argument;

    /* Initial boot delay — give SIM800L time to power up */
    osDelay(5000);

    /* Initialise: wait for network + GPRS + MQTT connect */
    bool ok = false;
    while (!ok)
    {
        ok = SIM800L_Init();
        if (!ok) osDelay(10000); /* retry after 10 s if init fails */
    }

    /* Lock state at boot (security default) */
    prv_UpdateRelay();

    /* Main GSM loop: publish every 2 s, handle incoming messages */
    uint32_t lastPublish = 0;

    for (;;)
    {
        /* --- Reconnect if lost --- */
        if (!SIM800L_IsMQTTConnected())
        {
            SIM800L_ConnectMQTT();
            osDelay(2000);
        }

        /* --- Poll incoming URC (LOCK/UNLOCK commands) --- */
        SIM800L_Process();

        /* --- Periodic publish every 2 000 ms --- */
        uint32_t now = osKernelGetTickCount();
        if (now - lastPublish >= 2000)
        {
            lastPublish = now;
            prv_SimulateVehicle();
            osMutexAcquire(gsm_mutex, osWaitForever);
            prv_PublishStatus();
            osMutexRelease(gsm_mutex);
        }

        osDelay(50); /* yield — main loop runs at ~20 Hz */
    }
}

/* =========================================================================
 * Task: RF Remote / Relay
 * ========================================================================= */
void StartRfTask(void *argument)
{
    (void)argument;

    RF433_Init();

    for (;;)
    {
        /* RF433_ProcessCommand checks the volatile flag set by EXTI ISR */
        RF433_ProcessCommand();
        osDelay(50);
    }
}
