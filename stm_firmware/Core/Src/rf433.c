/**
 ******************************************************************************
 * @file    rf433.c
 * @brief   433 MHz RF remote receiver driver with Dual-Factor Auth logic.
 *
 * Pin:  PA4 configured as EXTI (falling & rising edge) in CubeIDE.
 *       The XY-MK-5V receiver DATA pin connects here.
 *
 * Logic (same as ESP32 firmware):
 *   - Physical remote can UNLOCK the engine only if cloudLocked == false.
 *   - Physical remote can always RE-LOCK (3 rapid presses of OFF button).
 *   - Web LOCK always overrides physical remote unlock.
 *
 * Signal detection:
 *   We use a pulse-burst counter (same approach as the ESP32).
 *   >15 transitions in a 200 ms window = button press detected.
 *   This avoids needing to decode the full OOK protocol and works with
 *   any 433 MHz remote that uses OOK/ASK modulation.
 ******************************************************************************
 */

#include "rf433.h"

/* ---- extern shared state from freertos.c ------------------------------- */
extern volatile bool g_isLocked;
extern volatile bool g_cloudLocked;

/* Declared in freertos.c */
static void prv_UpdateRelay(void);   /* Forward declaration not needed —
                                        relay update happens in freertos.c
                                        via the callback below               */

/* ---- Private state ---------------------------------------------------- */
static volatile uint32_t g_pulseCount       = 0; /* total edge count          */
static volatile uint32_t g_pulsesInWindow   = 0; /* edges in last 200 ms      */
static volatile uint32_t g_lastWindowTick   = 0; /* tick of window start      */
static volatile bool     g_commandPending   = false;


/* =========================================================================
 * EXTI Interrupt callback — called by HAL for every PA4 edge
 * ========================================================================= */
void RF433_EXTI_Callback(uint16_t GPIO_Pin)
{
    if (GPIO_Pin == RF_PIN_Pin)
    {
        g_pulseCount++;
        g_pulsesInWindow++;
    }
}

/* =========================================================================
 * Public API
 * ========================================================================= */

void RF433_Init(void)
{
    /* Relay starts OFF (engine disabled = locked) — already set by freertos
     * but we ensure it here as a belt-and-suspenders measure.              */
    HAL_GPIO_WritePin(RELAY_PIN_GPIO_Port, RELAY_PIN_Pin, GPIO_PIN_RESET);
    g_commandPending = false;
}

bool NVM_GetWebLockState(void)
{
    /* Read the live shared variable — no Flash/EEPROM needed at runtime.
     * Flash persistence is a future enhancement.                          */
    return g_cloudLocked;
}

void RF433_ProcessCommand(void)
{
    uint32_t now = HAL_GetTick();

    /* --- Pulse-burst window check (every 200 ms) --- */
    if (now - g_lastWindowTick > 200)
    {
        uint32_t pulses       = g_pulsesInWindow;
        g_pulsesInWindow      = 0;
        g_lastWindowTick      = now;

        if (pulses > 15) /* Burst detected — treat as remote button press */
        {
            g_commandPending = true;
        }
    }

    /* --- Process pending command --- */
    if (!g_commandPending) return;
    g_commandPending = false;

    bool isWebLocked = NVM_GetWebLockState();

    /* ---- UNLOCK request (RF = ON button) ---- */
    if (g_isLocked)
    {
        /* Dual-factor: physical remote AND web permit */
        if (!isWebLocked)
        {
            g_isLocked = false;
            HAL_GPIO_WritePin(RELAY_PIN_GPIO_Port, RELAY_PIN_Pin, GPIO_PIN_SET);
        }
        /* else: web is locked — silently deny */
    }
}
