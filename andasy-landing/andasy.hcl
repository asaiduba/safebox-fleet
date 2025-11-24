# andasy.hcl for SafeBox landing page

app_name = "safebox"

app {
  env = {}
  port = 80

  compute {
    cpu      = 1
    memory   = 128
    cpu_kind = "shared"
  }

  process {
    name = "safebox-landing"
  }
}
