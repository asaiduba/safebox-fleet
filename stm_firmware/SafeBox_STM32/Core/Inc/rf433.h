#ifndef INC_RF433_H_
#define INC_RF433_H_

#include "stm32f1xx_hal.h"
#include <stdint.h>
#include <stdbool.h>

/* Defines matching the HAL GPIO config */
#define RF_PIN GPIO_PIN_4
#define RF_PORT GPIOA

void RF433_Init(void);
void RF433_EXTI_Callback(uint16_t GPIO_Pin);
void RF433_ProcessCommand(void);

#endif /* INC_RF433_H_ */
