/**
 ******************************************************************************
 * @file    rf433.c
 * @brief   433 MHz RF remote receiver driver.
 *
 * Pin:  PA4 configured as EXTI (falling & rising edge) in CubeIDE.
 *       The XY-MK-5V receiver DATA pin connects here.
 *
 * Detection strategy (SIMPLIFIED — edge-triggered with debounce):
 *   Any edge on PA4 triggers a pending command.
 *   A 1000 ms cooldown prevents re-triggering while the button is held.
 *   This works reliably because XY-MK-5V produces only 1-2 data pulses
 *   per remote frame — too few for a window/threshold burst-counter.
 *
 * 2FA NOTE: cloudLocked gate is intentionally DISABLED for hardware
 *   verification. Re-enable the guard in RF433_ProcessCommand once relay
 *   physical operation is confirmed.
 ******************************************************************************
 */

#include "rf433.h"
#include "main.h"
#include "FreeRTOS.h"
#include "task.h"

/* ---- extern shared state from freertos.c ------------------------------- */
extern volatile bool g_isLocked;
extern volatile bool g_cloudLocked;

/* ---- Private state ---------------------------------------------------- */
static volatile uint32_t g_lastEdgeTick     = 0;   /* tick of last edge        */
static volatile bool     g_commandPending   = false;


/* =========================================================================
 * EXTI Interrupt callback — called by HAL for every PA4 edge
 * ========================================================================= */
void RF433_EXTI_Callback(uint16_t GPIO_Pin)
{
    if (GPIO_Pin == RF_PIN_Pin)
    {
        uint32_t now = HAL_GetTick();

        /* Fire on the FIRST edge after the debounce window expires.
         * Reduced to 400ms to comfortably allow exactly 2 presses within 2 seconds. */
        if (now - g_lastEdgeTick > 400)
        {
            g_commandPending = true;
            g_lastEdgeTick   = now;
        }
    }
}

/* =========================================================================
 * Public API
 * ========================================================================= */

void RF433_Init(void)
{
    /* Relay starts OFF (engine disabled = locked) */
    HAL_GPIO_WritePin(RELAY_PIN_GPIO_Port, RELAY_PIN_Pin, GPIO_PIN_RESET);
    g_commandPending = false;
    g_lastOffPressTick = 0;
}


void RF433_ProcessCommand(void)
{
    /* --- Process pending command (set by ISR) --- */
    if (!g_commandPending) return;
    g_commandPending = false;

    taskENTER_CRITICAL();

    /* ----------------------------------------------------------
     * 2FA GATE: RF remote only operates the relay when the web
     * dashboard has granted permission (cloudLocked == false).
     *
     * Scenario A — Web UNLOCKED (cloudLocked=false):
     *   - If OFF (locked): 1 press → ON (unlocked)
     *   - If ON (unlocked): 2 presses within 2s → OFF (locked)
     *
     * Scenario B — Web LOCKED (cloudLocked=true):
     *   Remote press → silently rejected, relay stays OFF.
     *   User must UNLOCK from the dashboard first.
     * ---------------------------------------------------------- */
    if (g_cloudLocked == false)
    {
        if (g_isLocked == true)
        {
            /* System is currently OFF (locked). 
             * 1 press turns it ON (unlocked). */
            g_isLocked = false;
            HAL_GPIO_WritePin(RELAY_PIN_GPIO_Port, RELAY_PIN_Pin, GPIO_PIN_SET);
        }
    }
    else
    {
        /* Permission denied — enforce locked state */
        g_isLocked = true;
        HAL_GPIO_WritePin(RELAY_PIN_GPIO_Port, RELAY_PIN_Pin, GPIO_PIN_RESET);
    }

    taskEXIT_CRITICAL();
}
