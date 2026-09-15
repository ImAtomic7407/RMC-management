import os
import gzip
import struct

SIGNATURE = b"ENDSLEY/BSDIFF43"

def write_bsdiff_long(value):
    # Writes a long (8 bytes) in little-endian signed-magnitude format
    if value < 0:
        val = (-value) & 0x7FFFFFFFFFFFFFFF
        val |= (1 << 63)
    else:
        val = value & 0x7FFFFFFFFFFFFFFF
    return struct.pack("<Q", val)

def read_bsdiff_long(data, offset):
    val = struct.unpack_from("<Q", data, offset)[0]
    is_negative = (val & (1 << 63)) != 0
    magnitude = val & ~(1 << 63)
    if is_negative:
        return -magnitude, offset + 8
    return magnitude, offset + 8

def generate_patch(old_bytes, new_bytes):
    old_size = len(old_bytes)
    new_size = len(new_bytes)
    
    # Index the old file
    chunk_size = 16
    step = 8
    old_index = {}
    for i in range(0, old_size - chunk_size, step):
        chunk = old_bytes[i:i+chunk_size]
        if chunk not in old_index:
            old_index[chunk] = i
            
    patch_stream = bytearray()
    patch_stream.extend(SIGNATURE)
    patch_stream.extend(write_bsdiff_long(new_size))
    
    j = 0
    old_offset = 0
    
    while j < new_size:
        # Find next match at or after j
        match_idx = -1
        match_len = 0
        match_j = j
        
        while match_j <= new_size - chunk_size:
            chunk = new_bytes[match_j : match_j + chunk_size]
            if chunk in old_index:
                idx = old_index[chunk]
                # Extend match forward
                f_len = 0
                while idx + f_len < old_size and match_j + f_len < new_size and old_bytes[idx+f_len] == new_bytes[match_j+f_len]:
                    f_len += 1
                match_idx = idx
                match_len = f_len
                break
            match_j += 1
            
        if match_len < chunk_size:
            # No more matches found. The rest of new_bytes is a mismatch (copy only).
            diff_len = 0
            copy_len = new_size - j
            offset_to_next = 0
            
            patch_stream.extend(write_bsdiff_long(diff_len))
            patch_stream.extend(write_bsdiff_long(copy_len))
            patch_stream.extend(write_bsdiff_long(offset_to_next))
            
            patch_stream.extend(new_bytes[j:])
            break
            
        if match_j > j:
            # Write mismatch directive to advance new_offset to match_j and old_offset to match_idx
            diff_len = 0
            copy_len = match_j - j
            offset_to_next = match_idx - old_offset
            
            patch_stream.extend(write_bsdiff_long(diff_len))
            patch_stream.extend(write_bsdiff_long(copy_len))
            patch_stream.extend(write_bsdiff_long(offset_to_next))
            
            patch_stream.extend(new_bytes[j:match_j])
            
            old_offset = match_idx
            j = match_j
            
        # Write match directive
        diff_len = match_len
        copy_len = 0
        offset_to_next = 0
        
        patch_stream.extend(write_bsdiff_long(diff_len))
        patch_stream.extend(write_bsdiff_long(copy_len))
        patch_stream.extend(write_bsdiff_long(offset_to_next))
        
        # Write diff bytes (addends = new - old)
        diff_bytes = bytes((new_bytes[j + k] - old_bytes[old_offset + k]) & 0xFF for k in range(diff_len))
        patch_stream.extend(diff_bytes)
        
        old_offset += diff_len
        j += diff_len
        
    return bytes(patch_stream)

def apply_patch(old_bytes, patch_bytes):
    if not patch_bytes.startswith(SIGNATURE):
        raise ValueError("Bad signature")
        
    new_size, offset = read_bsdiff_long(patch_bytes, len(SIGNATURE))
    
    new_bytes = bytearray(new_size)
    old_size = len(old_bytes)
    
    old_offset = 0
    new_offset = 0
    
    while new_offset < new_size:
        diff_len, offset = read_bsdiff_long(patch_bytes, offset)
        copy_len, offset = read_bsdiff_long(patch_bytes, offset)
        offset_to_next, offset = read_bsdiff_long(patch_bytes, offset)
        
        if diff_len > 0:
            diff_bytes = patch_bytes[offset : offset + diff_len]
            offset += diff_len
            
            for k in range(diff_len):
                old_byte = old_bytes[old_offset + k] if (old_offset + k) < old_size else 0
                addend = diff_bytes[k]
                new_bytes[new_offset + k] = (old_byte + addend) & 0xFF
            
            new_offset += diff_len
            old_offset += diff_len
            
        if copy_len > 0:
            copy_bytes = patch_bytes[offset : offset + copy_len]
            offset += copy_len
            new_bytes[new_offset : new_offset + copy_len] = copy_bytes
            new_offset += copy_len
            
        old_offset += offset_to_next
        
    return bytes(new_bytes)

# Test execution
if __name__ == "__main__":
    old = b"Hello world! This is the old file content with some text that will remain the same. And some modified text."
    new = b"Hello world! This is the new file content with some text that will remain the same. And some highly updated text!"
    
    print("Old size:", len(old))
    print("New size:", len(new))
    
    patch = generate_patch(old, new)
    print("Raw patch size:", len(patch))
    
    reconstructed = apply_patch(old, patch)
    print("Reconstructed:", reconstructed)
    print("Expected:     ", new)
    print("Match:", reconstructed == new)
    assert reconstructed == new
    
    # Test with GZIP
    compressed = gzip.compress(patch)
    print("Compressed patch size:", len(compressed))
    decompressed = gzip.decompress(compressed)
    print("Decompressed match:", decompressed == patch)
