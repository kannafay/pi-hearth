use crate::desktop::{self, Lifecycle, Shutdown};
use image::{Rgba, RgbaImage, imageops::FilterType};
use tauri::{
    App, AppHandle, Manager,
    image::Image,
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem},
};

#[path = "styled.rs"]
mod styled;
pub use styled::install as apply_style;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Action {
    Show,
    Restart,
    Quit,
}

impl Action {
    fn from_id(id: &str) -> Option<Self> {
        match id {
            "tray-show" => Some(Self::Show),
            "tray-restart" => Some(Self::Restart),
            "tray-quit" => Some(Self::Quit),
            _ => None,
        }
    }
}

pub fn create(app: &mut App) -> tauri::Result<Menu<tauri::Wry>> {
    let show = MenuItem::with_id(app, "tray-show", "界面", true, None::<&str>)?;
    let restart = MenuItem::with_id(app, "tray-restart", "重启", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "tray-quit", "退出", true, None::<&str>)?;
    Menu::with_items(app, &[&show, &restart, &separator, &quit])
}

pub fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    if app.state::<Lifecycle>().is_shutting_down() {
        return;
    }
    match Action::from_id(event.id.as_ref()) {
        Some(Action::Show) => {
            let _ = desktop::show_window(app);
        }
        Some(Action::Restart) => desktop::shutdown(app, Shutdown::Restart),
        Some(Action::Quit) => desktop::shutdown(app, Shutdown::Exit(0)),
        None => {}
    }
}

fn icon(action: Action, size: u32, foreground: [u8; 3]) -> Image<'static> {
    // Supersampling keeps the original line icons smooth at each monitor's DPI.
    let color = [foreground[0], foreground[1], foreground[2], 255];
    let mut image = RgbaImage::new(size * 4, size * 4);
    let mut paths: Vec<Vec<(f32, f32)>> = match action {
        Action::Show => vec![
            vec![
                (4.0, 4.0),
                (20.0, 4.0),
                (22.0, 6.0),
                (22.0, 18.0),
                (20.0, 20.0),
                (4.0, 20.0),
                (2.0, 18.0),
                (2.0, 6.0),
                (4.0, 4.0),
            ],
            vec![(2.0, 8.0), (22.0, 8.0)],
            vec![(6.0, 4.0), (6.0, 8.0)],
            vec![(10.0, 4.0), (10.0, 8.0)],
        ],
        Action::Restart => vec![vec![(21.0, 3.0), (21.0, 8.0), (16.0, 8.0)]],
        Action::Quit => vec![
            vec![
                (9.0, 3.0),
                (5.0, 3.0),
                (3.0, 5.0),
                (3.0, 19.0),
                (5.0, 21.0),
                (9.0, 21.0),
            ],
            vec![(9.0, 12.0), (21.0, 12.0)],
            vec![(16.0, 7.0), (21.0, 12.0), (16.0, 17.0)],
        ],
    };
    if action == Action::Restart {
        paths.push(
            (0..=42)
                .map(|step| {
                    let angle = (step as f32 * 7.5).to_radians();
                    (12.0 + 9.0 * angle.cos(), 12.0 + 9.0 * angle.sin())
                })
                .chain([(21.0, 8.0)])
                .collect(),
        );
    }
    let scale = (size * 4) as f32 / 24.0;
    for path in paths {
        for points in path.windows(2) {
            let (ax, ay) = (points[0].0 * scale, points[0].1 * scale);
            let (bx, by) = (points[1].0 * scale, points[1].1 * scale);
            let length = (bx - ax).powi(2) + (by - ay).powi(2);
            for (x, y, pixel) in image.enumerate_pixels_mut() {
                let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
                let t = if length == 0.0 {
                    0.0
                } else {
                    (((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / length).clamp(0.0, 1.0)
                };
                if (px - ax - t * (bx - ax)).powi(2) + (py - ay - t * (by - ay)).powi(2)
                    <= (0.8 * scale).powi(2)
                {
                    *pixel = Rgba(color);
                }
            }
        }
    }
    let image = image::imageops::resize(&image, size, size, FilterType::Lanczos3);
    Image::new_owned(image.into_raw(), size, size)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn menu_events_only_dispatch_the_three_tray_actions() {
        assert_eq!(Action::from_id("tray-show"), Some(Action::Show));
        assert_eq!(Action::from_id("tray-restart"), Some(Action::Restart));
        assert_eq!(Action::from_id("tray-quit"), Some(Action::Quit));
        for id in ["quit", "restart", "settings", "", "tray-quit-other"] {
            assert_eq!(Action::from_id(id), None);
        }
    }
}
