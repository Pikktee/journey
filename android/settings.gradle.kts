// Luhambo Android — eigenständiges Gradle-Projekt im Monorepo (Plan M3).
// Ein Modul (:app); Schichten leben als Pakete, nicht als Gradle-Module.

pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "luhambo"
include(":app")
