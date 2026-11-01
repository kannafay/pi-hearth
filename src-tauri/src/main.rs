// Desktop builds should not open an extra console, including debug builds.
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    let args: Vec<_> = std::env::args_os().collect();
    if args.len() == 3 && args[1] == "--runtime-check" {
        let result = pi_hearth_lib::installation_check(std::path::Path::new(&args[2]));
        std::process::exit(if result.is_ok() { 0 } else { 1 });
    }
    pi_hearth_lib::run()
}
