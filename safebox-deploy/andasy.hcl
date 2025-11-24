# andasy.hcl app configuration file generated for safebox on Sunday, 23-Nov-25 00:35:49 SAST
#
# See https://github.com/quarksgroup/andasy-cli for information about how to use this file.

app_name = "safebox"

app {

  env = {}

  port = 3000

  compute {
    cpu      = 1
    memory   = 256
    cpu_kind = "shared"
  }

  process {
    name = "safebox"
  }

}
