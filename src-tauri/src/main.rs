// Desktop builds should not open an extra console, including debug builds.
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    pi_hearth_lib::run()
}
