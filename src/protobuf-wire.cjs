'use strict';
function varint(buffer,offset=0){let value=0n,shift=0n,start=offset;while(offset<buffer.length&&offset-start<10){const b=buffer[offset++];value|=BigInt(b&127)<<shift;if(!(b&128))return {value,offset};shift+=7n;}throw Error('Invalid protobuf varint');}
function encode(n){n=BigInt(n);if(n<0n)throw Error('Negative varint');const bytes=[];do{let b=Number(n&127n);n>>=7n;if(n)b|=128;bytes.push(b);}while(n);return Buffer.from(bytes);}
function fields(buffer){const out=[];let offset=0;while(offset<buffer.length){const start=offset,t=varint(buffer,offset);offset=t.offset;const number=Number(t.value>>3n),wire=Number(t.value&7n);if(number<1||number>536870911)throw Error('Invalid protobuf field');let value,data;
 if(wire===0){const x=varint(buffer,offset);value=x.value;offset=x.offset;}else if(wire===2){const x=varint(buffer,offset),size=Number(x.value);offset=x.offset;if(!Number.isSafeInteger(size)||size>buffer.length-offset)throw Error('Truncated protobuf');data=buffer.subarray(offset,offset+size);offset+=size;}else if(wire===1||wire===5){const size=wire===1?8:4;data=buffer.subarray(offset,offset+size);offset+=size;}else throw Error('Unsupported protobuf wire type');if(offset>buffer.length)throw Error('Truncated protobuf');out.push({number,wire,value,data,raw:buffer.subarray(start,offset)});
 }return out;}
function bytes(number,data){return Buffer.concat([encode(number*8+2),encode(data.length),data]);}
function uint(number,value){return Buffer.concat([encode(number*8),encode(value)]);}
function get(rows,n){return rows.find(x=>x.number===n);}
function num(rows,n,defaultValue=0){const v=get(rows,n);return v?Number(v.value):defaultValue;}
function str(rows,n){const v=get(rows,n);return v?.data?.toString('utf8')||'';}
module.exports={fields,bytes,uint,get,num,str,encode,varint};
