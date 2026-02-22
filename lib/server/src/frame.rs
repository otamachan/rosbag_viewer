// Binary frame format
//
// Offset  Size  Type       Description
// 0       2     u16 LE     topic_id
// 2       8     u64 LE     timestamp (nanoseconds)
// 10      4     u32 LE     payload_length
// 14      N     [u8]       payload

pub const HEADER_SIZE: usize = 14;

pub fn write_data_frame(buf: &mut Vec<u8>, topic_id: u16, timestamp_ns: u64, payload: &[u8]) {
    buf.reserve(HEADER_SIZE + payload.len());
    buf.extend_from_slice(&topic_id.to_le_bytes());
    buf.extend_from_slice(&timestamp_ns.to_le_bytes());
    buf.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    buf.extend_from_slice(payload);
}
