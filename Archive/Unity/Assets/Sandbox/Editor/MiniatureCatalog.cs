using System;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace ArSandbox
{
    // Original, code-authored geometry. Dimensions are metres at scale one;
    // every prefab has a support-plane pivot and primitive colliders.
    public static class MiniatureCatalog
    {
        private const string Root = "Assets/Sandbox/WhiteRoom";
        private static readonly Color Grass = new Color(.30f, .53f, .29f);
        private static readonly Color Earth = new Color(.53f, .39f, .27f);
        private static readonly Color Stone = new Color(.55f, .56f, .54f);
        private static readonly Color Wood = new Color(.50f, .31f, .17f);
        private static readonly Color Leaf = new Color(.16f, .41f, .28f);
        private static readonly Color Roof = new Color(.65f, .29f, .20f);

        public static PrefabEntry[] Create()
        {
            Directory.CreateDirectory(Root + "/Prefabs");
            Directory.CreateDirectory(Root + "/Materials");
            return new[]
            {
                Make("grass_tile", "Grass tile", "20 cm terrain tile; align edges at 20 cm intervals.", r => Box(r,"Turf",0,.005f,0,.2f,.01f,.2f,Grass)),
                Make("dirt_tile", "Dirt tile", "20 cm terrain tile; align edges at 20 cm intervals.", r => Box(r,"Soil",0,.005f,0,.2f,.01f,.2f,Earth)),
                Make("road_straight", "Straight road", "20 cm road segment along local Z.", r => Road(r,false)),
                Make("road_corner", "Corner road", "20 cm road corner connecting local -Z to +X.", r => Road(r,true)),
                Make("pine_tree", "Pine tree", "Miniature conifer, 18 cm tall.", r => Tree(r,true)),
                Make("oak_tree", "Oak tree", "Miniature broadleaf tree, 16 cm tall.", r => Tree(r,false)),
                Make("shrub", "Shrub", "Low landscape shrub.", r => { Ball(r,"Crown",0,.035f,0,.07f,.06f,.07f,Leaf); }),
                Make("rock", "Rock", "Small grey landscape rock.", r => Ball(r,"Rock",0,.023f,0,.075f,.045f,.06f,Stone)),
                Make("boulder", "Boulder", "Large grey landscape rock.", r => Ball(r,"Boulder",0,.045f,0,.12f,.09f,.10f,Stone)),
                Make("cottage", "Cottage", "Miniature home; doorway faces local -Z.", r => Building(r,false)),
                Make("tower", "Watchtower", "Miniature lookout tower; entrance faces local -Z.", r => Building(r,true)),
                Make("fence", "Fence", "20 cm fence section along local X.", r => Fence(r)),
                Make("bridge", "Footbridge", "20 cm crossing along local Z.", r => Bridge(r)),
                Make("well", "Village well", "Stone well with a timber roof.", r => Well(r)),
                Make("street_lamp", "Street lamp", "Select to switch the warm light on or off after adding a select toggle.", r => Lamp(r)),
                Make("chest", "Treasure chest", "Select to open or close the lid after adding a select toggle.", r => Chest(r))
            };
        }

        private static PrefabEntry Make(string id, string name, string description, Action<GameObject> build)
        {
            var root = new GameObject(name);
            build(root);
            var prefab = PrefabUtility.SaveAsPrefabAsset(root, Root + "/Prefabs/" + id + ".prefab");
            UnityEngine.Object.DestroyImmediate(root);
            return new PrefabEntry { assetId = id, displayName = name, description = description,
                spawnScale = 1f, prefab = prefab,
                interactionMode = id == "street_lamp" ? "light" : id == "chest" ? "hinge" : null };
        }

        private static void Road(GameObject root, bool corner)
        {
            Box(root,"Roadbed",0,.006f,0,.2f,.012f,.2f,Grass);
            if (corner)
            {
                Box(root,"Entry",0,.013f,-.048f,.055f,.004f,.105f,Stone);
                Box(root,"Turn",.05f,.013f,0,.105f,.004f,.055f,Stone);
            }
            else Box(root,"Paving",0,.013f,0,.055f,.004f,.2f,Stone);
        }

        private static void Tree(GameObject root, bool pine)
        {
            Box(root,"Trunk",0,.055f,0,.018f,.11f,.018f,Wood);
            if (pine)
            {
                Cone(root,"Lower boughs",0,.112f,0,.105f,.09f,Leaf);
                Cone(root,"Upper boughs",0,.155f,0,.075f,.08f,Leaf);
            }
            else
            {
                Ball(root,"Canopy",0,.125f,0,.12f,.095f,.11f,Leaf);
                Ball(root,"Canopy side",.04f,.10f,0,.07f,.06f,.08f,Leaf);
            }
        }

        private static void Building(GameObject root, bool tower)
        {
            float width = tower ? .09f : .14f, height = tower ? .18f : .11f;
            Box(root,"Walls",0,height/2,0,width,height,width,Material("plaster",new Color(.82f,.75f,.62f)));
            Box(root,"Door",0,.028f,-width/2-.001f,.028f,.055f,.004f,Wood);
            if (tower)
            {
                Box(root,"Battlement",0,height+.008f,0,.11f,.016f,.11f,Stone);
                foreach (float x in new[] { -.045f,.045f })
                    Box(root,"Merlon",x,height+.025f,-.045f,.018f,.035f,.018f,Stone);
            }
            else
            {
                Box(root,"Roof left",-.037f,height+.026f,0,.085f,.012f,.16f,Roof, new Vector3(0,0,33));
                Box(root,"Roof right",.037f,height+.026f,0,.085f,.012f,.16f,Roof, new Vector3(0,0,-33));
                Box(root,"Window",.045f,.065f,-.071f,.02f,.025f,.003f,Material("glass",new Color(.20f,.55f,.66f)));
            }
        }

        private static void Fence(GameObject root)
        {
            foreach (float x in new[] { -.09f,0,.09f })
                Box(root,"Post",x,.04f,0,.012f,.08f,.012f,Wood);
            Box(root,"Rail low",0,.025f,0,.2f,.009f,.009f,Wood);
            Box(root,"Rail high",0,.058f,0,.2f,.009f,.009f,Wood);
        }

        private static void Bridge(GameObject root)
        {
            Box(root,"Deck",0,.028f,0,.10f,.012f,.2f,Wood);
            foreach (float x in new[] { -.055f,.055f })
            {
                Box(root,"Rail",x,.066f,0,.009f,.009f,.2f,Wood);
                foreach (float z in new[] { -.08f,.08f })
                    Box(root,"Post",x,.05f,z,.009f,.05f,.009f,Wood);
            }
        }

        private static void Well(GameObject root)
        {
            Box(root,"Base",0,.025f,0,.095f,.05f,.095f,Stone);
            Box(root,"Water",0,.051f,0,.07f,.003f,.07f,Material("water",new Color(.18f,.43f,.58f)));
            foreach (float x in new[] { -.045f,.045f }) Box(root,"Post",x,.09f,0,.008f,.10f,.008f,Wood);
            Box(root,"Canopy",0,.145f,0,.12f,.015f,.11f,Roof);
        }

        private static void Lamp(GameObject root)
        {
            Box(root,"Foot",0,.009f,0,.045f,.018f,.045f,Stone);
            Box(root,"Post",0,.085f,0,.012f,.16f,.012f,Wood);
            Box(root,"Lantern",0,.174f,0,.048f,.045f,.048f,Material("lantern",new Color(.95f,.77f,.36f)));
            var light = new GameObject("InteractivePart").AddComponent<Light>();
            light.transform.SetParent(root.transform,false); light.transform.localPosition = new Vector3(0,.174f,0);
            light.type = LightType.Point; light.range = .6f; light.intensity = 1.8f; light.color = new Color(1f,.75f,.4f);
            light.enabled = false;
        }

        private static void Chest(GameObject root)
        {
            Box(root,"Box",0,.028f,0,.09f,.055f,.065f,Wood);
            var hinge = new GameObject("InteractivePart");
            hinge.transform.SetParent(root.transform,false);
            hinge.transform.localPosition = new Vector3(0,.057f,.032f);
            Box(hinge,"Lid",0,.007f,-.032f,.095f,.014f,.07f,Roof);
            Box(hinge,"Band",0,.016f,-.032f,.012f,.004f,.07f,Stone);
        }

        private static void Box(GameObject root, string name, float x, float y, float z,
            float width, float height, float depth, Color color, Vector3 rotation = default)
        {
            Box(root,name,x,y,z,width,height,depth,Material(name.ToLowerInvariant().Replace(' ','_')+"_"+
                ColorUtility.ToHtmlStringRGB(color),color),rotation);
        }

        private static void Box(GameObject root, string name, float x, float y, float z,
            float width, float height, float depth, Material material, Vector3 rotation = default)
        {
            var part = GameObject.CreatePrimitive(PrimitiveType.Cube);
            part.name = name; part.transform.SetParent(root.transform,false);
            part.transform.localPosition = new Vector3(x,y,z);
            part.transform.localRotation = Quaternion.Euler(rotation);
            part.transform.localScale = new Vector3(width,height,depth);
            part.GetComponent<Renderer>().sharedMaterial = material;
        }

        private static void Ball(GameObject root, string name, float x, float y, float z,
            float width, float height, float depth, Color color)
        {
            var part = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            part.name = name; part.transform.SetParent(root.transform,false);
            part.transform.localPosition = new Vector3(x,y,z); part.transform.localScale = new Vector3(width,height,depth);
            part.GetComponent<Renderer>().sharedMaterial = Material(name.ToLowerInvariant()+"_"+ColorUtility.ToHtmlStringRGB(color),color);
        }

        private static void Cone(GameObject root, string name, float x, float y, float z,
            float width, float height, Color color)
        {
            // A tapered three-tier conifer assembled from existing low-poly cylinders.
            for (int i = 0; i < 3; i++)
            {
                var part = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                part.name = name + " " + i; part.transform.SetParent(root.transform,false);
                part.transform.localPosition = new Vector3(x,y+(i-1)*height*.23f,z);
                part.transform.localScale = new Vector3(width*(1-.23f*i),height*.22f,width*(1-.23f*i));
                part.GetComponent<Renderer>().sharedMaterial = Material("pine_"+ColorUtility.ToHtmlStringRGB(color),color);
            }
        }

        private static Material Material(string id, Color color)
        {
            string path = Root + "/Materials/mini_" + id + ".mat";
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(Shader.Find("Standard"));
                AssetDatabase.CreateAsset(material,path);
            }
            material.color = color; material.SetFloat("_Glossiness",.14f);
            EditorUtility.SetDirty(material);
            return material;
        }
    }
}
