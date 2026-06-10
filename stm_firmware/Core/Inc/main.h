#ifndef __MAIN_H
#define __MAIN_H

#ifdef __cplusplus
extern "C" {
#endif

/* Includes ------------------------------------------------------------------*/
#include "stm32f1xx_hal.h"   // ← NUCLEO-F103RB (Cortex-M3, 72 MHz)

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */
#include "cmsis_os.h" // FreeRTOS
/* USER CODE END Includes */

/* Exported types ------------------------------------------------------------*/
/* USER CODE BEGIN ET */

/* USER CODE END ET */

/* Exported constants --------------------------------------------------------*/
/* USER CODE BEGIN EC */

/* USER CODE END EC */

/* Exported macro ------------------------------------------------------------*/
/* USER CODE BEGIN EM */

/* USER CODE END EM */

/* Exported functions prototypes ---------------------------------------------*/
void Error_Handler(void);

/* USER CODE BEGIN EFP */
void StartGpsTask(void *argument);
void StartGsmTask(void *argument);
void StartRfTask(void *argument);
/* USER CODE END EFP */

/* Private defines -----------------------------------------------------------*/
#define RF_PIN_Pin          GPIO_PIN_4
#define RF_PIN_GPIO_Port    GPIOA
#define RF_PIN_EXTI_IRQn    EXTI4_IRQn

// PA5 is the onboard LED (LD2) on NUCLEO-F103RB — relay moved to PB0
#define RELAY_PIN_Pin       GPIO_PIN_0
#define RELAY_PIN_GPIO_Port GPIOB

/* USER CODE BEGIN Private defines */

/* GPS DMA receive buffer — must hold at least one full GPRMC sentence (~80 bytes) */
#define GPS_DMA_RX_BUFFER_SIZE 256

/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
