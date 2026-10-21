use tauri::{
    App, Wry,
    image::Image,
    menu::{IconMenuItem, Menu, PredefinedMenuItem},
};

fn icon(bytes: &[u8]) -> Result<Image<'static>, image::ImageError> {
    let image = image::load_from_memory(bytes)?.into_rgba8();
    let (width, height) = image.dimensions();
    Ok(Image::new_owned(image.into_raw(), width, height))
}

pub fn create(app: &App) -> Result<Menu<Wry>, Box<dyn std::error::Error>> {
    let show = IconMenuItem::with_id(
        app,
        "show",
        "界面",
        true,
        Some(icon(include_bytes!("../icons/tray/show.png"))?),
        None::<&str>,
    )?;
    let restart = IconMenuItem::with_id(
        app,
        "restart",
        "重启",
        true,
        Some(icon(include_bytes!("../icons/tray/restart.png"))?),
        None::<&str>,
    )?;
    let quit = IconMenuItem::with_id(
        app,
        "quit",
        "退出",
        true,
        Some(icon(include_bytes!("../icons/tray/quit.png"))?),
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    Ok(Menu::with_items(
        app,
        &[&show, &restart, &separator, &quit],
    )?)
}
