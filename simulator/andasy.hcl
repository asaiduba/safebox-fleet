# andasy.hcl app configuration file for safebox-simulator

app_name = "safebox-simulator"

app {

  env = {
    MQTT_BROKER = "mqtt://safebox-v2.andasy.dev:1883"
  }

  compute {
    cpu      = 1
    memory   = 256
    cpu_kind = "shared"
  }

  process {
    name = "simulator"
  }

}
