/**
 * Dynamic ROS1 binary message decoder.
 *
 * Decodes raw ROS1 serialized bytes using schema information
 * received from the server's GET /api/bag/info endpoint.
 *
 * Numeric arrays (uint8[], float32[], float64[], etc.) are returned
 * as TypedArrays for zero-overhead use with Three.js / Canvas.
 */

export interface Field {
  name: string;
  type: string;
  isArray: boolean;
  arrayLength?: number;
  isComplex: boolean;
  isConstant?: boolean;
  constantValue?: string;
}

export interface MsgSchema {
  name: string | null;
  fields: Field[];
}

/** Map from message type name to its schema list (as returned by /api/bag/info). */
export type SchemaMap = Record<string, MsgSchema[]>;

/**
 * Build a flat type lookup from the server's schema map.
 * Each message type's schema list contains:
 *   [0] top-level type (name=null)
 *   [1..] sub-type definitions (name="package/Type")
 */
export function buildTypeMap(schemas: SchemaMap): Map<string, MsgSchema> {
  const map = new Map<string, MsgSchema>();
  for (const [msgType, list] of Object.entries(schemas)) {
    if (list.length > 0) {
      map.set(msgType, list[0]);
    }
    for (let i = 1; i < list.length; i++) {
      const sub = list[i];
      if (sub.name) {
        map.set(sub.name, sub);
      }
    }
  }
  return map;
}

class BinaryReader {
  private static textDecoder = new TextDecoder();
  private view: DataView;
  private buf: Uint8Array;
  offset: number;

  constructor(view: DataView) {
    this.view = view;
    this.buf = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    this.offset = 0;
  }

  readBool(): boolean {
    return this.view.getUint8(this.offset++) !== 0;
  }

  readInt8(): number {
    return this.view.getInt8(this.offset++);
  }

  readUint8(): number {
    return this.view.getUint8(this.offset++);
  }

  readInt16(): number {
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }

  readUint16(): number {
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  readInt32(): number {
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readUint32(): number {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readInt64(): bigint {
    const v = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    return v;
  }

  readUint64(): bigint {
    const v = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return v;
  }

  readFloat32(): number {
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readFloat64(): number {
    const v = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return v;
  }

  readString(): string {
    const len = this.readUint32();
    const bytes = this.buf.subarray(this.offset, this.offset + len);
    this.offset += len;
    return BinaryReader.textDecoder.decode(bytes);
  }

  readTime(): { secs: number; nsecs: number } {
    const secs = this.readUint32();
    const nsecs = this.readUint32();
    return { secs, nsecs };
  }

  readDuration(): { secs: number; nsecs: number } {
    const secs = this.readInt32();
    const nsecs = this.readInt32();
    return { secs, nsecs };
  }

  /** Copy raw bytes into a new TypedArray (handles unaligned access). */
  readTypedArrayCopy<T extends ArrayBufferView>(
    length: number,
    bytesPerElement: number,
    Ctor: new (buf: ArrayBuffer) => T,
  ): T {
    const byteLen = length * bytesPerElement;
    const copy = new ArrayBuffer(byteLen);
    new Uint8Array(copy).set(this.buf.subarray(this.offset, this.offset + byteLen));
    this.offset += byteLen;
    return new Ctor(copy);
  }
}

export class RosDecoder {
  private typeMap: Map<string, MsgSchema>;

  constructor(typeMap: Map<string, MsgSchema>) {
    this.typeMap = typeMap;
  }

  /** Decode a ROS1 message from a DataView. */
  decode(typeName: string, payload: DataView): Record<string, unknown> {
    const reader = new BinaryReader(payload);
    return this.decodeType(typeName, reader);
  }

  private decodeType(typeName: string, r: BinaryReader): Record<string, unknown> {
    const schema = this.typeMap.get(typeName);
    if (!schema) {
      throw new Error(`Unknown type: ${typeName}`);
    }

    const result: Record<string, unknown> = {};
    for (const field of schema.fields) {
      if (field.isConstant) continue;

      if (field.isArray) {
        result[field.name] = this.decodeArray(field, r);
      } else if (field.isComplex) {
        result[field.name] = this.decodeType(field.type, r);
      } else {
        result[field.name] = this.decodePrimitive(field.type, r);
      }
    }
    return result;
  }

  private decodeArray(field: Field, r: BinaryReader): unknown {
    const length = field.arrayLength ?? r.readUint32();

    // Optimization: return TypedArrays for numeric arrays
    if (!field.isComplex) {
      switch (field.type) {
        case "uint8":
          return r.readTypedArrayCopy(length, 1, Uint8Array);
        case "int8":
          return r.readTypedArrayCopy(length, 1, Int8Array);
        case "bool":
          return r.readTypedArrayCopy(length, 1, Uint8Array);
        case "uint16":
          return r.readTypedArrayCopy(length, 2, Uint16Array);
        case "int16":
          return r.readTypedArrayCopy(length, 2, Int16Array);
        case "uint32":
          return r.readTypedArrayCopy(length, 4, Uint32Array);
        case "int32":
          return r.readTypedArrayCopy(length, 4, Int32Array);
        case "float32":
          return r.readTypedArrayCopy(length, 4, Float32Array);
        case "float64":
          return r.readTypedArrayCopy(length, 8, Float64Array);
      }
    }

    // General case: element-by-element
    const arr: unknown[] = [];
    for (let i = 0; i < length; i++) {
      if (field.isComplex) {
        arr.push(this.decodeType(field.type, r));
      } else {
        arr.push(this.decodePrimitive(field.type, r));
      }
    }
    return arr;
  }

  private decodePrimitive(type: string, r: BinaryReader): unknown {
    switch (type) {
      case "bool":
        return r.readBool();
      case "int8":
        return r.readInt8();
      case "uint8":
        return r.readUint8();
      case "int16":
        return r.readInt16();
      case "uint16":
        return r.readUint16();
      case "int32":
        return r.readInt32();
      case "uint32":
        return r.readUint32();
      case "int64":
        return r.readInt64();
      case "uint64":
        return r.readUint64();
      case "float32":
        return r.readFloat32();
      case "float64":
        return r.readFloat64();
      case "string":
        return r.readString();
      case "time":
        return r.readTime();
      case "duration":
        return r.readDuration();
      default:
        throw new Error(`Unknown primitive type: ${type}`);
    }
  }
}
