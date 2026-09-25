"""Fixed Blender runner for a validated declarative blueprint. Run headless."""
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector


def build(blueprint_path, glb_path, metadata_path):
    recipe = json.loads(Path(blueprint_path).read_text(encoding="utf-8"))
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    created = []
    for part in recipe["parts"]:
        kind = part["kind"]
        if kind == "cube":
            bpy.ops.mesh.primitive_cube_add(size=1)
        elif kind == "cylinder":
            bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=1, depth=2)
        elif kind == "sphere":
            bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12)
        elif kind == "cone":
            bpy.ops.mesh.primitive_cone_add(vertices=20, radius1=1, radius2=0, depth=2)
        elif kind == "torus":
            bpy.ops.mesh.primitive_torus_add(major_segments=24, minor_segments=8, major_radius=1, minor_radius=.22)
        obj = bpy.context.object
        obj.name = part["name"]
        bpy.context.view_layer.update()
        obj.dimensions = part["dimensions"]
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.location = part["location"]
        obj.rotation_euler = part["rotation"]
        material = bpy.data.materials.new(name=part["name"] + " material")
        material.use_nodes = True
        shader = material.node_tree.nodes.get("Principled BSDF")
        color = part["color"]
        channels = tuple(int(color[n:n + 2], 16) / 255 for n in (1, 3, 5))
        shader.inputs["Base Color"].default_value = (*channels, 1)
        shader.inputs["Metallic"].default_value = part["metallic"]
        shader.inputs["Roughness"].default_value = part["roughness"]
        if part["emission"]:
            shader.inputs["Emission Color"].default_value = (*channels, 1)
            shader.inputs["Emission Strength"].default_value = part["emission"]
        material.diffuse_color = (*channels, 1)
        obj.data.materials.append(material)
        created.append(obj)
    bpy.context.view_layer.update()
    points = [obj.matrix_world @ Vector(corner) for obj in created for corner in obj.bound_box]
    minimum = [min(p[axis] for p in points) for axis in range(3)]
    maximum = [max(p[axis] for p in points) for axis in range(3)]
    size = [maximum[axis] - minimum[axis] for axis in range(3)]
    if any(not math.isfinite(n) or n <= .001 or n > 20 for n in size):
        raise ValueError("Generated object needs finite 3D bounds within 20 metres")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in created:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = created[0]
    bpy.ops.export_scene.gltf(filepath=str(glb_path), export_format="GLB", use_selection=True,
                              export_materials="EXPORT", export_image_format="AUTO")
    # Blender is Z-up; glTF/Three.js is Y-up. The exporter rotates axes.
    bounds = {"center": {"x": 0, "y": size[2] / 2, "z": 0},
              "size": {"x": size[0], "y": size[2], "z": size[1]}}
    Path(metadata_path).write_text(json.dumps({"localBounds": bounds}), encoding="utf-8")


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:]
    build(*args)
