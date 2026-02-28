use rust_embed::Embed;

#[derive(Embed)]
#[folder = "../../app/frontend/dist"]
struct Asset;

fn main() {
    rosbag_viewer::app::run::<Asset>("rosbag-viewer-app");
}
