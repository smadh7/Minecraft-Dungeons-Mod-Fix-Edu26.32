"""Minimal little-endian NBT (Bedrock on-disk format) reader/writer.

Round-trips byte-for-byte (verified against every record in the world).
"""
import struct, io
# Little-endian Bedrock NBT (disk format)
TAG_END,TAG_BYTE,TAG_SHORT,TAG_INT,TAG_LONG,TAG_FLOAT,TAG_DOUBLE,TAG_BYTE_ARRAY,TAG_STRING,TAG_LIST,TAG_COMPOUND,TAG_INT_ARRAY,TAG_LONG_ARRAY=range(13)
class T:
    __slots__=("t","v")
    def __init__(s,t,v): s.t=t; s.v=v
    def __repr__(s): return f"T({s.t},{s.v!r})"
def _rs(f):
    n=struct.unpack('<H',f.read(2))[0]; return f.read(n).decode('utf-8','surrogateescape')
def _ws(f,s):
    b=s.encode('utf-8','surrogateescape'); f.write(struct.pack('<H',len(b))); f.write(b)
def rp(f,t):
    if t==1: return struct.unpack('<b',f.read(1))[0]
    if t==2: return struct.unpack('<h',f.read(2))[0]
    if t==3: return struct.unpack('<i',f.read(4))[0]
    if t==4: return struct.unpack('<q',f.read(8))[0]
    if t==5: return struct.unpack('<f',f.read(4))[0]
    if t==6: return struct.unpack('<d',f.read(8))[0]
    if t==7: n=struct.unpack('<i',f.read(4))[0]; return f.read(n)
    if t==8: return _rs(f)
    if t==9:
        et=f.read(1)[0]; n=struct.unpack('<i',f.read(4))[0]; return (et,[rp(f,et) for _ in range(n)])
    if t==10:
        d={}
        while True:
            tt=f.read(1)[0]
            if tt==0: return d
            k=_rs(f); d[k]=T(tt,rp(f,tt))
    if t==11: n=struct.unpack('<i',f.read(4))[0]; return list(struct.unpack(f'<{n}i',f.read(4*n)))
    if t==12: n=struct.unpack('<i',f.read(4))[0]; return list(struct.unpack(f'<{n}q',f.read(8*n)))
    raise ValueError(t)
def wp(f,t,v):
    if t==1: f.write(struct.pack('<b',v))
    elif t==2: f.write(struct.pack('<h',v))
    elif t==3: f.write(struct.pack('<i',v))
    elif t==4: f.write(struct.pack('<q',v))
    elif t==5: f.write(struct.pack('<f',v))
    elif t==6: f.write(struct.pack('<d',v))
    elif t==7: f.write(struct.pack('<i',len(v))); f.write(v)
    elif t==8: _ws(f,v)
    elif t==9:
        et,items=v; f.write(bytes([et])); f.write(struct.pack('<i',len(items)))
        for it in items: wp(f,et,it)
    elif t==10:
        for k,x in v.items(): f.write(bytes([x.t])); _ws(f,k); wp(f,x.t,x.v)
        f.write(b'\0')
    elif t==11: f.write(struct.pack('<i',len(v))); f.write(struct.pack(f'<{len(v)}i',*v))
    elif t==12: f.write(struct.pack('<i',len(v))); f.write(struct.pack(f'<{len(v)}q',*v))
def read_root(f):
    t=f.read(1)[0]; name=_rs(f); return name,T(t,rp(f,t))
def write_root(f,name,tag):
    f.write(bytes([tag.t])); _ws(f,name); wp(f,tag.t,tag.v)
def read_all(data):
    f=io.BytesIO(data); out=[]
    while f.tell()<len(data): out.append(read_root(f))
    return out
def dump(tag,ind=0,name=""):
    p="  "*ind
    if tag.t==10:
        print(f"{p}{name}: {{"); 
        for k,x in tag.v.items(): dump(x,ind+1,k)
        print(f"{p}}}")
    elif tag.t==9:
        et,items=tag.v; print(f"{p}{name}: list[{et}] x{len(items)}")
        for i,it in enumerate(items): dump(T(et,it),ind+1,f"[{i}]")
    elif tag.t==7: print(f"{p}{name}: bytes({len(tag.v)})")
    else: print(f"{p}{name} ({tag.t}): {tag.v!r}")
