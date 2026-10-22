// Bundled desktop builds should not open an extra console, including debug builds.
#![cfg_attr(
    any(not(debug_assertions), feature = "custom-protocol"),
    windows_subsystem = "windows"
)]

fn main() {
    pi_hearth_lib::run()
}
