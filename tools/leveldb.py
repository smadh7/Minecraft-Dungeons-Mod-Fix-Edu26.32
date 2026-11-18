"""Minimal reader + log appender for Bedrock (Mojang fork) LevelDB worlds.

Reading supports the block compressions Bedrock uses: 0 (none), 2 (zlib) and
4 (raw deflate, Mojang's default).  Writing is done the same way LevelDB
itself writes: new WriteBatch records are appended to the current .log file.
The game replays that log when the world is opened and compacts it into its
tables, so the existing .ldb tables are never rewritten by this tool.
"""
import os
import struct
import zlib

BLOCK = 32768
FULL, FIRST, MIDDLE, LAST = 1, 2, 3, 4


# --------------------------------------------------------------------------
# helpers
def varint(b, p):
    r = s = 0
    while True:
        c = b[p]
        p += 1
        r |= (c & 0x7F) << s
        s += 7
        if c < 0x80:
            return r, p


def put_varint(n):
    out = bytearray()
    while True:
        c = n & 0x7F
        n >>= 7
        if n:
            out.append(c | 0x80)
        else:
            out.append(c)
            return bytes(out)


_CRC_TABLE = []
for _i in range(256):
    _c = _i
    for _ in range(8):
        _c = (_c >> 1) ^ 0x82F63B78 if _c & 1 else _c >> 1
    _CRC_TABLE.append(_c)


def crc32c(data, crc=0):
    crc ^= 0xFFFFFFFF
    t = _CRC_TABLE
    for b in data:
        crc = t[(crc ^ b) & 0xFF] ^ (crc >> 8)
    return crc ^ 0xFFFFFFFF


def masked_crc(data):
    c = crc32c(data)
    return ((((c >> 15) | (c << 17)) & 0xFFFFFFFF) + 0xA282EAD8) & 0xFFFFFFFF


# --------------------------------------------------------------------------
# log format
def read_log_records(data, verify_crc=False):
    """Return (records, problems) for a LevelDB log-format file."""
    p = 0
    buf = b""
    n = len(data)
    recs = []
    problems = []
    while p < n:
        left = BLOCK - (p % BLOCK)
        if left < 7:
            p += left
            continue
        if p + 7 > n:
            problems.append(("truncated header", p))
            break
        crc, ln, t = struct.unpack("<IHB", data[p:p + 7])
        if t == 0 and ln == 0:
            p += left
            continue
        payload = data[p + 7:p + 7 + ln]
        if len(payload) < ln:
            problems.append(("truncated payload", p))
            break
        if verify_crc and masked_crc(bytes([t]) + payload) != crc:
            problems.append(("bad crc", p))
        p += 7 + ln
        if t == FULL:
            recs.append(payload)
            buf = b""
        elif t == FIRST:
            buf = payload
        elif t == MIDDLE:
            buf += payload
        elif t == LAST:
            buf += payload
            recs.append(buf)
            buf = b""
        else:
            problems.append(("bad record type %d" % t, p))
            break
    return recs, problems


def encode_log_records(records, start_offset):
    """Encode records exactly as leveldb::log::Writer would, continuing a file
    that currently ends at ``start_offset``."""
    out = bytearray()
    block_off = start_offset % BLOCK
    for rec in records:
        left = memoryview(rec)
        begin = True
        while True:
            leftover = BLOCK - block_off
            if leftover < 7:
                out += b"\0" * leftover
                block_off = 0
            avail = BLOCK - block_off - 7
            frag = min(len(left), avail)
            end = frag == len(left)
            t = FULL if begin and end else FIRST if begin else LAST if end else MIDDLE
            chunk = bytes(left[:frag])
            out += struct.pack("<IHB", masked_crc(bytes([t]) + chunk), frag, t)
            out += chunk
            block_off += 7 + frag
            left = left[frag:]
            begin = False
            if end:
                break
    return bytes(out)


def parse_batch(rec):
    seq, cnt = struct.unpack("<QI", rec[:12])
    p = 12
    out = []
    for i in range(cnt):
        tag = rec[p]
        p += 1
        kl, p = varint(rec, p)
        k = rec[p:p + kl]
        p += kl
        if tag == 1:
            vl, p = varint(rec, p)
            out.append((seq + i, k, rec[p:p + vl]))
            p += vl
        else:
            out.append((seq + i, k, None))
    return out


def encode_batch(seq, ops):
    """ops: list of (key, value_or_None_for_delete)"""
    out = bytearray(struct.pack("<QI", seq, len(ops)))
    for k, v in ops:
        if v is None:
            out += b"\x00" + put_varint(len(k)) + k
        else:
            out += b"\x01" + put_varint(len(k)) + k + put_varint(len(v)) + v
    return bytes(out)


# --------------------------------------------------------------------------
# tables
def _decomp(raw, t):
    if t == 0:
        return raw
    if t == 2:
        return zlib.decompress(raw)
    if t == 4:
        return zlib.decompress(raw, -15)
    raise ValueError("unsupported block compression %d" % t)


def _read_block(f, off, size):
    f.seek(off)
    raw = f.read(size + 5)
    return _decomp(raw[:size], raw[size])


def _block_entries(b):
    nr = struct.unpack("<I", b[-4:])[0]
    end = len(b) - 4 - 4 * nr
    p = 0
    key = b""
    while p < end:
        sh, p = varint(b, p)
        ns, p = varint(b, p)
        vl, p = varint(b, p)
        key = key[:sh] + b[p:p + ns]
        p += ns
        yield key, b[p:p + vl]
        p += vl


def read_table(path):
    with open(path, "rb") as f:
        f.seek(-48, 2)
        foot = f.read(48)
        if struct.unpack("<Q", foot[40:])[0] != 0xDB4775248B80FB57:
            raise ValueError("bad table magic: " + path)
        p = 0
        _, p = varint(foot, p)
        _, p = varint(foot, p)
        io_, p = varint(foot, p)
        is_, p = varint(foot, p)
        for _, h in _block_entries(_read_block(f, io_, is_)):
            q = 0
            o, q = varint(h, q)
            s, q = varint(h, q)
            for ik, v in _block_entries(_read_block(f, o, s)):
                tag = struct.unpack("<Q", ik[-8:])[0]
                yield ik[:-8], tag >> 8, tag & 0xFF, v


def parse_manifest(data):
    recs, probs = read_log_records(data)
    edits = []
    for r in recs:
        p = 0
        e = {"new": [], "del": []}
        while p < len(r):
            tag, p = varint(r, p)
            if tag == 1:
                ln, p = varint(r, p)
                e["comparator"] = r[p:p + ln]
                p += ln
            elif tag in (2, 3, 4, 9):
                v, p = varint(r, p)
                e[{2: "log", 3: "next", 4: "lastseq", 9: "prevlog"}[tag]] = v
            elif tag == 5:
                _, p = varint(r, p)
                ln, p = varint(r, p)
                p += ln
            elif tag == 6:
                lv, p = varint(r, p)
                num, p = varint(r, p)
                e["del"].append((lv, num))
            elif tag == 7:
                lv, p = varint(r, p)
                num, p = varint(r, p)
                sz, p = varint(r, p)
                ln, p = varint(r, p)
                p += ln
                ln, p = varint(r, p)
                p += ln
                e["new"].append((lv, num, sz))
            else:
                raise ValueError("unknown manifest tag %d" % tag)
        edits.append(e)
    return edits, probs


class World:
    """Read-only snapshot of a world's db folder + helper to append changes."""

    def __init__(self, path):
        self.path = path
        cur = open(os.path.join(path, "CURRENT")).read().strip()
        edits, probs = parse_manifest(open(os.path.join(path, cur), "rb").read())
        if probs:
            raise ValueError("manifest problems: %r" % probs)
        files = {}
        self.log_number = 0
        for e in edits:
            for lv, num, sz in e["new"]:
                files[num] = sz
            for lv, num in e["del"]:
                files.pop(num, None)
            self.log_number = e.get("log", self.log_number)
        latest = {}
        for num in sorted(files):
            tp = os.path.join(path, "%06d.ldb" % num)
            if os.path.getsize(tp) != files[num]:
                raise ValueError("table size mismatch: " + tp)
            for k, seq, t, v in read_table(tp):
                if k not in latest or latest[k][0] < seq:
                    latest[k] = (seq, v if t == 1 else None)
        self.logs = sorted(int(x[:-4]) for x in os.listdir(path)
                           if x.endswith(".log") and int(x[:-4]) >= self.log_number)
        for ln in self.logs:
            recs, lp = read_log_records(open(self._log(ln), "rb").read(), verify_crc=True)
            if lp:
                raise ValueError("log %d problems: %r" % (ln, lp))
            for r in recs:
                for seq, k, v in parse_batch(r):
                    if k not in latest or latest[k][0] < seq:
                        latest[k] = (seq, v)
        self.max_seq = max(s for s, _ in latest.values())
        self.data = {k: v for k, (s, v) in latest.items() if v is not None}

    def _log(self, n):
        return os.path.join(self.path, "%06d.log" % n)

    def append(self, ops, batch_bytes=512 * 1024):
        """Append (key, value|None) operations to the newest log file."""
        if not self.logs:
            raise ValueError("no live log file to append to")
        batches = []
        cur = []
        size = 0
        seq = self.max_seq + 1
        for op in ops:
            cur.append(op)
            size += len(op[0]) + (len(op[1]) if op[1] is not None else 0)
            if size >= batch_bytes:
                batches.append(encode_batch(seq, cur))
                seq += len(cur)
                cur, size = [], 0
        if cur:
            batches.append(encode_batch(seq, cur))
            seq += len(cur)
        logp = self._log(self.logs[-1])
        start = os.path.getsize(logp)
        with open(logp, "ab") as f:
            f.write(encode_log_records(batches, start))
        self.max_seq = seq - 1
        return len(batches)
