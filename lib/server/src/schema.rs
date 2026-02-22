use serde::Serialize;

fn is_false(v: &bool) -> bool {
    !v
}

#[derive(Debug, Clone, Serialize)]
pub struct Field {
    pub name: String,
    #[serde(rename = "type")]
    pub field_type: String,
    #[serde(rename = "isArray")]
    pub is_array: bool,
    #[serde(rename = "arrayLength", skip_serializing_if = "Option::is_none")]
    pub array_length: Option<u32>,
    #[serde(rename = "isComplex")]
    pub is_complex: bool,
    #[serde(rename = "isConstant", skip_serializing_if = "is_false")]
    pub is_constant: bool,
    #[serde(rename = "constantValue", skip_serializing_if = "Option::is_none")]
    pub constant_value: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MsgSchema {
    pub name: Option<String>,
    pub fields: Vec<Field>,
}
