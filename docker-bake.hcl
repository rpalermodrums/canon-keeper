group "default" {
  targets = ["lint", "typecheck", "test", "build"]
}

group "ci" {
  targets = ["lint", "typecheck", "test", "build"]
}

group "dev" {
  targets = ["dev"]
}

target "dev" {}
target "lint" {}
target "typecheck" {}
target "test" {}
target "build" {}
