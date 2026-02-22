use crate::schema::{Field, MsgSchema};

const PRIMITIVE_TYPES: &[&str] = &[
    "bool", "int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float32",
    "float64", "string", "time", "duration", "byte", "char",
];

/// Parse a .msg definition text (from a bag connection record) into a list of MsgSchema.
///
/// The input may contain multiple type definitions separated by lines of '=' (37+ chars).
/// The first block (before any separator) is the top-level type (name = None).
/// Subsequent blocks start with `MSG: package/TypeName`.
pub fn parse_msg_definition(definition: &str) -> Vec<MsgSchema> {
    let mut schemas = Vec::new();
    let mut current_name: Option<String> = None;
    let mut current_fields: Vec<Field> = Vec::new();
    let mut first_block = true;

    for line in definition.lines() {
        let trimmed = line.trim();

        // Separator: line of 5+ '=' characters
        if trimmed.len() >= 5 && trimmed.bytes().all(|b| b == b'=') {
            schemas.push(MsgSchema {
                name: if first_block {
                    None
                } else {
                    current_name.take()
                },
                fields: std::mem::take(&mut current_fields),
            });
            first_block = false;
            continue;
        }

        // Sub-type header
        if let Some(rest) = trimmed.strip_prefix("MSG: ") {
            current_name = Some(rest.trim().to_string());
            continue;
        }

        // Strip inline comments
        let line = match trimmed.find('#') {
            Some(0) => continue, // full-line comment
            Some(pos) => trimmed[..pos].trim(),
            None => trimmed,
        };

        if line.is_empty() {
            continue;
        }

        if let Some(field) = parse_field(line) {
            current_fields.push(field);
        }
    }

    // Save the last (or only) block
    if !current_fields.is_empty() || first_block {
        schemas.push(MsgSchema {
            name: if first_block {
                None
            } else {
                current_name.take()
            },
            fields: current_fields,
        });
    }

    resolve_short_names(&mut schemas);
    schemas
}

/// Resolve unqualified complex type names (e.g. "Pose") to their fully qualified
/// form (e.g. "geometry_msgs/Pose") using the sub-schema definitions in the same
/// message definition.
fn resolve_short_names(schemas: &mut [MsgSchema]) {
    let full_names: Vec<String> = schemas.iter().filter_map(|s| s.name.clone()).collect();

    for schema in schemas.iter_mut() {
        for field in &mut schema.fields {
            if field.is_complex && !field.field_type.contains('/') {
                for full_name in &full_names {
                    if full_name.ends_with(&format!("/{}", field.field_type)) {
                        field.field_type = full_name.clone();
                        break;
                    }
                }
            }
        }
    }
}

fn parse_field(line: &str) -> Option<Field> {
    let parts: Vec<&str> = line.splitn(2, char::is_whitespace).collect();
    if parts.len() != 2 {
        return None;
    }

    let type_str = parts[0].trim();
    let name_value = parts[1].trim();

    // Check for constant: NAME=VALUE
    let (name, is_constant, constant_value) = if let Some(eq_pos) = name_value.find('=') {
        let name = name_value[..eq_pos].trim().to_string();
        let value = name_value[eq_pos + 1..].trim().to_string();
        (name, true, Some(value))
    } else {
        (name_value.to_string(), false, None)
    };

    // Parse array notation: type[], type[N]
    let (base_type, is_array, array_length) = if let Some(bracket_start) = type_str.find('[') {
        let base = &type_str[..bracket_start];
        let bracket_end = type_str.find(']')?;
        let bracket_content = &type_str[bracket_start + 1..bracket_end];
        if bracket_content.is_empty() {
            (base, true, None)
        } else {
            let len: u32 = bracket_content.parse().ok()?;
            (base, true, Some(len))
        }
    } else {
        (type_str, false, None)
    };

    // Handle aliases
    let base_type = match base_type {
        "byte" => "int8",
        "char" => "uint8",
        "Header" => "std_msgs/Header",
        _ => base_type,
    };

    let is_complex = !PRIMITIVE_TYPES.contains(&base_type);

    Some(Field {
        name,
        field_type: base_type.to_string(),
        is_array,
        array_length,
        is_complex,
        is_constant,
        constant_value,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_definition() {
        let def = "float64 x\nfloat64 y\nfloat64 z\n";
        let schemas = parse_msg_definition(def);
        assert_eq!(schemas.len(), 1);
        assert!(schemas[0].name.is_none());
        assert_eq!(schemas[0].fields.len(), 3);
        assert_eq!(schemas[0].fields[0].name, "x");
        assert_eq!(schemas[0].fields[0].field_type, "float64");
        assert!(!schemas[0].fields[0].is_complex);
    }

    #[test]
    fn test_nested_definition() {
        let def = "\
Header header
geometry_msgs/Quaternion orientation
float64[9] orientation_covariance
=====================================
MSG: std_msgs/Header
uint32 seq
time stamp
string frame_id
=====================================
MSG: geometry_msgs/Quaternion
float64 x
float64 y
float64 z
float64 w
";
        let schemas = parse_msg_definition(def);
        assert_eq!(schemas.len(), 3);

        // Top-level
        assert!(schemas[0].name.is_none());
        assert_eq!(schemas[0].fields.len(), 3);
        assert_eq!(schemas[0].fields[0].field_type, "std_msgs/Header");
        assert!(schemas[0].fields[0].is_complex);
        assert_eq!(schemas[0].fields[2].field_type, "float64");
        assert!(schemas[0].fields[2].is_array);
        assert_eq!(schemas[0].fields[2].array_length, Some(9));

        // std_msgs/Header
        assert_eq!(schemas[1].name.as_deref(), Some("std_msgs/Header"));
        assert_eq!(schemas[1].fields.len(), 3);
        assert_eq!(schemas[1].fields[1].field_type, "time");

        // geometry_msgs/Quaternion
        assert_eq!(schemas[2].name.as_deref(), Some("geometry_msgs/Quaternion"));
        assert_eq!(schemas[2].fields.len(), 4);
    }

    #[test]
    fn test_constant() {
        let def = "uint8 NONE=0\nuint8 status\n";
        let schemas = parse_msg_definition(def);
        assert_eq!(schemas[0].fields.len(), 2);
        assert!(schemas[0].fields[0].is_constant);
        assert_eq!(schemas[0].fields[0].constant_value.as_deref(), Some("0"));
        assert!(!schemas[0].fields[1].is_constant);
    }

    #[test]
    fn test_variable_length_array() {
        let def = "float32[] ranges\n";
        let schemas = parse_msg_definition(def);
        assert!(schemas[0].fields[0].is_array);
        assert!(schemas[0].fields[0].array_length.is_none());
    }

    #[test]
    fn test_aliases() {
        let def = "byte b\nchar c\nHeader h\n";
        let schemas = parse_msg_definition(def);
        assert_eq!(schemas[0].fields[0].field_type, "int8");
        assert_eq!(schemas[0].fields[1].field_type, "uint8");
        assert_eq!(schemas[0].fields[2].field_type, "std_msgs/Header");
        assert!(schemas[0].fields[2].is_complex);
    }
}
