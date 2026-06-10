/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * File Name          : freertos.c
  * Description        : Code for freertos applications
  ******************************************************************************
  * @attention
  *
  * Copyright (c) 2026 STMicroelectronics.
  * All rights reserved.
  *
  * This software is licensed under terms that can be found in the LICENSE file
  * in the root directory of this software component.
  * If no LICENSE file comes with this software, it is provided AS-IS.
  *
  ******************************************************************************
  */
/* USER CODE END Header */

/* Includes ------------------------------------------------------------------*/
#include "FreeRTOS.h"
#include "task.h"
#include "main.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */
#include <stdbool.h>
#include <string.h>
#include "main.h"
/* USER CODE END Includes */

/* Private typedef -----------------------------------------------------------*/
/* USER CODE BEGIN PTD */

/* USER CODE END PTD */

/* Private define ------------------------------------------------------------*/
/* USER CODE BEGIN PD */

/* USER CODE END PD */

/* Private macro -------------------------------------------------------------*/
/* USER CODE BEGIN PM */

/* USER CODE END PM */

/* Private variables ---------------------------------------------------------*/
/* USER CODE BEGIN Variables */

/* USER CODE END Variables */

/* Private function prototypes -----------------------------------------------*/
/* USER CODE BEGIN FunctionPrototypes */

/* USER CODE END FunctionPrototypes */

/* Private application code --------------------------------------------------*/
/* USER CODE BEGIN Application */

/* Extern shared state (defined in main.c) */
extern volatile bool  g_isLocked;
extern volatile bool  g_cloudLocked;

/**
  * @brief  Called by sim800l.c when a LOCK or UNLOCK MQTT message arrives.
  *         Overrides the weak stub in sim800l.c.
  */
void ESP_OnCommandReceived(const char *command)
{
    taskENTER_CRITICAL();
    if (strstr(command, "UNLOCK"))
    {
        /* Web UNLOCK: Grant permission, but do NOT energize relay yet.
         * The driver must press the RF remote to actually start the engine. */
        g_cloudLocked = false;
        // Do NOT change g_isLocked here! We wait for physical remote press.
    }
    else /* LOCK */
    {
        /* Web LOCK: instantly cut the engine and revoke permission. */
        g_cloudLocked = true;
        g_isLocked    = true;
        HAL_GPIO_WritePin(Relay_pin_GPIO_Port, Relay_pin_Pin, GPIO_PIN_RESET);
    }
    taskEXIT_CRITICAL();
}

/* USER CODE END Application */

