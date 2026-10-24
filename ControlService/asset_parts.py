"""Bounded, descriptive parts. Metadata is not proof of function or executable code."""
import hashlib
import json
import math
import re

MAX_PARTS = 64


def checked_parts(parts, nodes=None):
    if not isinstance(parts, list) or len(parts) > MAX_PARTS:
        raise ValueError('An asset supports at most 64 teaching parts')
    result, ids = [], set()
    for part in parts:
        if not isinstance(part, dict) or not {'partId', 'label', 'nodeIndex'} <= set(part) <= {
                'partId', 'label', 'nodeIndex', 'primitiveIndex', 'localPoint', 'description', 'provenance'}:
            raise ValueError('Invalid teaching part fields')
        identifier = part['partId']
        if not isinstance(identifier, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,79}', identifier) or identifier in ids:
            raise ValueError('Invalid or duplicate part ID')
        node = part['nodeIndex']
        if type(node) is not int or not 0 <= node < 256 or nodes is not None and node >= nodes:
            raise ValueError('Invalid part node index')
        label, description = part['label'], part.get('description', '')
        if (not isinstance(label, str) or not 1 <= len(label) <= 120 or
                not isinstance(description, str) or len(description) > 600 or
                any(ord(char) < 32 for char in label + description)):
            raise ValueError('Invalid part description')
        value = {'partId': identifier, 'label': label, 'nodeIndex': node,
                 'description': description, 'provenance': part.get('provenance', 'authored')}
        if value['provenance'] not in ('authored', 'node-name'):
            raise ValueError('Invalid part provenance')
        if 'primitiveIndex' in part:
            index = part['primitiveIndex']
            if type(index) is not int or not 0 <= index < 256:
                raise ValueError('Invalid part primitive index')
            value['primitiveIndex'] = index
        if 'localPoint' in part:
            point = part['localPoint']
            if not isinstance(point, dict) or set(point) != {'x', 'y', 'z'} or any(
                    type(v) not in (int, float) or not math.isfinite(v) or abs(v) > 20 for v in point.values()):
                raise ValueError('Invalid part local point')
            value['localPoint'] = {axis: (0.0 if point[axis] == 0 else float(point[axis])) for axis in ('x','y','z')}
        ids.add(identifier)
        result.append(value)
    return result


def inspect_parts(document):
    nodes = document.get('nodes', [])
    authored, automatic = [], []
    for index, node in enumerate(nodes):
        if not isinstance(node, dict):
            continue
        metadata = node.get('extras', {}).get('matrixPart') if isinstance(node.get('extras'), dict) else None
        if metadata is not None:
            if not isinstance(metadata, dict):
                raise ValueError('matrixPart must be an object')
            authored.extend(checked_parts([{**metadata, 'nodeIndex': index, 'provenance': 'authored'}], len(nodes)))
        elif 'mesh' in node:
            automatic.append({'partId': f'node-{index}', 'label': str(node.get('name') or f'Mesh {index}')[:120],
                              'nodeIndex': index, 'description': '', 'provenance': 'node-name'})
    return checked_parts((authored + automatic)[:MAX_PARTS], len(nodes))


def part_revision(parts):
    return hashlib.sha256(json.dumps(checked_parts(parts), sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def validate_targets(parts, document):
    parts = checked_parts(parts, len(document.get('nodes', [])))
    for part in parts:
        node = document['nodes'][part['nodeIndex']]
        if not isinstance(node, dict):
            raise ValueError('Invalid part node')
        if 'primitiveIndex' in part:
            index=node.get('mesh')
            if type(index) is not int or not 0 <= index < len(document.get('meshes', [])):
                raise ValueError('Part node has no valid mesh')
            mesh = document['meshes'][index]
            if part['primitiveIndex'] >= len(mesh.get('primitives', [])):
                raise ValueError('Part primitive does not exist on its node')
    return parts
