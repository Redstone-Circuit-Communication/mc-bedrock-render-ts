// this looks interesting: https://github.com/PrismarineJS/minecraft-data/blob/master/data/bedrock/1.20.71/blockCollisionShapes.json (Object.fromEntries(Object.entries(d.blocks).map(([name, indices])=>[name,indices.map(i=>d.shapes[i])])))
// READ: this also looks pretty comprehensive: https://github.com/MCBE-Development-Wiki/mcbe-dev-home/blob/main/docs/misc/enums/block_shape.md
// https://github.com/bricktea/MCStructure/blob/main/docs/1.16.201/enums/B.md
// The notes above are by the original author, SuperLlama88888, and are kept as they were.
"use strict";

(function () {
	"use strict";

	// In HoloPrint this file is an ES module importing helpers from utils.js.
	// neoHoloprintDB keeps this file as the actual core layer but inlines the small
	// helper subset so the plugin loader can load it as a classic script.
	const tuple = value => value;
	const NEO_FACE_NAMES = ["west", "east", "down", "up", "north", "south"];
	const NEO_SIDE_FACE_NAMES = ["west", "east", "north", "south"];
	const NEO_OUTPUT_FACE_NAMES = Object.freeze({
		// "west": "east",
		// "east": "west",
		"west": "west",
		"east": "east",
		"down": "down",
		"up": "up",
		"north": "north",
		"south": "south"
	});
	const NEO_BLOCKS_DOT_JSON_PATCHES = Object.freeze({
		"grass_block": "grass",
		"trip_wire": "tripWire",
		"sea_lantern": "seaLantern",
		"oak_planks": "planks.0",
		"spruce_planks": "planks.1",
		"birch_planks": "planks.2",
		"jungle_planks": "planks.3",
		"acacia_planks": "planks.4",
		"dark_oak_planks": "planks.5",
		"unknown": "info_update",
		"normal_stone_double_slab": "normal_stone_slab",
		"smooth_quartz_double_slab": "smooth_quartz_slab",
		"mossy_stone_brick_double_slab": "mossy_stone_brick_slab",
		"cut_sandstone_double_slab": "cut_sandstone_slab",
		"cut_red_sandstone_double_slab": "cut_red_sandstone_slab"
	});
	const NEO_BLOCKS_TO_USE_CARRIED_TEXTURES = Object.freeze(["acacia_leaves", "birch_leaves", "bush", "dark_oak_leaves", "fern", "firefly_bush", "leaves", "leaves2", "light_block", "light_block_0", "light_block_1", "light_block_2", "light_block_3", "light_block_4", "light_block_5", "light_block_6", "light_block_7", "light_block_8", "light_block_9", "light_block_10", "light_block_11", "light_block_12", "light_block_13", "light_block_14", "light_block_15", "mangrove_leaves", "oak_leaves", "open_eyeblossom", "short_grass", "spruce_leaves", "vine", "waterlily"]);
	const NEO_GLOBAL_STATE_DEFINITION_HINTS = Object.freeze({
		"observer": ["powered_bit", "minecraft:facing_direction"],
		"structure_block": ["structure_block_type"],
		"turtle_egg": ["cracked_state"],
		"sniffer_egg": ["cracked_state"],
		"farmland": ["moisturized_amount"],
		"pale_hanging_moss": ["tip"],
		"sculk_catalyst": ["bloom"],
		"sculk_shrieker": ["can_summon"],
		"respawn_anchor": ["respawn_anchor_charge"],
		"brown_mushroom_block": ["huge_mushroom_bits"],
		"red_mushroom_block": ["huge_mushroom_bits"],
		"suspicious_sand": ["brushed_progress"],
		"suspicious_gravel": ["brushed_progress"],
		"dried_ghast": ["rehydration_level"],
		"bee_nest": ["honey_level"],
		"beehive": ["honey_level"],
		"piston": ["facing_direction"],
		"sticky_piston": ["facing_direction"],
		"lever": ["lever_direction"],
		"crafter": ["orientation"],
		"chain": ["pillar_axis"],
		"chest": ["minecraft:cardinal_direction"],
		"trapped_chest": ["minecraft:cardinal_direction"],
		"copper_chest": ["minecraft:cardinal_direction"],
		"waxed_copper_chest": ["minecraft:cardinal_direction"],
		"exposed_copper_chest": ["minecraft:cardinal_direction"],
		"waxed_exposed_copper_chest": ["minecraft:cardinal_direction"],
		"weathered_copper_chest": ["minecraft:cardinal_direction"],
		"waxed_weathered_copper_chest": ["minecraft:cardinal_direction"],
		"oxidized_copper_chest": ["minecraft:cardinal_direction"],
		"waxed_oxidized_copper_chest": ["minecraft:cardinal_direction"],
		"ender_chest": ["minecraft:cardinal_direction"],
		"furnace": ["minecraft:cardinal_direction"],
		"blast_furnace": ["minecraft:cardinal_direction"],
		"smoker": ["minecraft:cardinal_direction"],
		"lit_furnace": ["minecraft:cardinal_direction"],
		"lit_blast_furnace": ["minecraft:cardinal_direction"],
		"lit_smoker": ["minecraft:cardinal_direction"],
		"small_amethyst_bud": ["minecraft:block_face"],
		"medium_amethyst_bud": ["minecraft:block_face"],
		"large_amethyst_bud": ["minecraft:block_face"],
		"amethyst_cluster": ["minecraft:block_face"],
		"standing_sign": ["ground_sign_direction"]
	});
	const NEO_GLOBAL_STATE_DEFINITION_HINT_PATTERNS = Object.freeze([
		[/_stairs$/, ["weirdo_direction"]],
		[/_standing_sign$/, ["ground_sign_direction"]],
		[/_coral_fan$/, ["coral_direction"]],
		[/_(log|wood|hyphae)$/, ["pillar_axis"]],
		[/^(stripped_)?(crimson_stem|warped_stem)$/, ["pillar_axis"]],
		[/^(stripped_)?(bamboo_block|basalt|polished_basalt|bone_block|hay_block|quartz_pillar)$/, ["pillar_axis"]]
	]);
	const neoNormalizeBlockName = blockName => String(blockName ?? "").trim().replace(/^minecraft:/, "");
	const neoClone = value => structuredClone(value);
	const addVec2 = (a, b) => [a[0] + b[0], a[1] + b[1]];
	const addVec3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
	const subVec3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
	const mulVec3 = (v, s) => [v[0] * s, v[1] * s, v[2] * s];
	const max = Math.max;
	const rotateDeg = ([x, y], degrees) => {
		const rad = degrees * Math.PI / 180;
		const cos = Math.cos(rad), sin = Math.sin(rad);
		return [x * cos - y * sin, x * sin + y * cos];
	};
	const crossProduct = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
	const normalizeVec3 = v => {
		const length = Math.hypot(v[0], v[1], v[2]);
		return length ? [v[0] / length, v[1] / length, v[2] / length] : [0, 0, 0];
	};
	const vec3ToFixed = (v, digits) => v.map(x => +x.toFixed(digits));
	const hexColorToClampedTriplet = color => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255);
	// TEST COPY: upstream semantics (index 0 = predicate false). The shipped neoHoloprintDB core returns them the other way round,
	// which makes #optimizeGeometry merge and cull the *rotated* cubes (see docs/HOLOPRINT.md).
	const conditionallyGroup = (arr, predicate) => [arr.filter(x => !predicate(x)), arr.filter(predicate)];
	const neoSortDescriptorCandidates = candidates => candidates.sort((a, b) => {
		const aNumber = Number(a), bNumber = Number(b);
		const aIsNumber = String(a).trim() != "" && !Number.isNaN(aNumber);
		const bIsNumber = String(b).trim() != "" && !Number.isNaN(bNumber);
		if (aIsNumber && bIsNumber) return aNumber - bNumber || String(a).localeCompare(String(b));
		return String(a).localeCompare(String(b));
	});
	const mulMat4 = (m, v) => [
		m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2] + m[0][3],
		m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2] + m[1][3],
		m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2] + m[2][3],
		m[3][0] * v[0] + m[3][1] * v[1] + m[3][2] * v[2] + m[3][3]
	];
	class JSONSet extends Set {
		#keys = [];
		add(value) {
			const key = JSON.stringify(value);
			if (!this.#keys.includes(key)) {
				this.#keys.push(key);
				super.add(value);
			}
			return this;
		}
		indexOf(value) {
			return this.#keys.indexOf(JSON.stringify(value));
		}
	}

	// https://wiki.bedrock.dev/visuals/material-creations.html#overlay-color-in-render-controllers
	// https://wiki.bedrock.dev/documentation/materials.html#entity-alphatest

	class NeoBlockGeoMaker {
		config;
		textureRefs = new JSONSet();
		#neoStrictBlockStateErrors = true;
		#console;

		#individualBlockShapes;
		#blockShapePatterns;
		#blockShapeGeos;
		#eigenvariants;

		#globalBlockStateRotations;
		#blockShapeBlockStateRotations = new Map();
		#blockNameBlockStateRotations = new Map();

		#globalBlockStateTextureVariants;
		#blockShapeBlockStateTextureVariants = new Map();
		#blockNameBlockStateTextureVariants = new Map();
		#blockNamePatternBlockStateTextureVariants = [];

		#cachedBlockShapes = new Map();
		blocksJson = null;
		terrainTextureJson = null;
		loadedPackName = null;

		/**
		 * @param {HoloPrintConfig} config
		 * @param {Data.BlockShapes} blockShapes
		 * @param {Data.BlockShapeGeos} blockShapeGeos
		 * @param {Data.BlockStateDefinitions} blockStateDefs
		 * @param {Data.BlockEigenvariants} eigenvariants
		 */
		constructor(config, blockShapes, blockShapeGeos, blockStateDefs, eigenvariants, coreConsole = globalThis.console ?? {}) {
			if (arguments.length == 4) {
				eigenvariants = blockStateDefs;
				blockStateDefs = blockShapeGeos;
				blockShapeGeos = blockShapes;
				blockShapes = config;
				config = { SCALE: 1, IGNORED_BLOCKS: [] };
			}
			this.config = config;
			const fallbackConsole = globalThis.console ?? {};
			this.#console = Object.fromEntries(["log", "debug", "warn", "error"].map(level => {
				const target = typeof coreConsole?.[level] == "function" ? coreConsole : fallbackConsole;
				const method = typeof target[level] == "function" ? target[level] : target.log;
				return [level, typeof method == "function" ? method.bind(target) : () => { }];
			}));

			this.#individualBlockShapes = blockShapes["individual_blocks"];
			this.#blockShapePatterns = Object.entries(blockShapes["patterns"]).map(([rule, blockShape]) => [new RegExp(rule), blockShape]); // store regular expressions from the start to avoid recompiling them every time
			this.#blockShapeGeos = blockShapeGeos;
			this.#eigenvariants = eigenvariants;

			// block-state-driven rotations/texture variants can either be global, based on block shape, based on specific block names, or based on regular expressions for block names, hence the many variables.
			this.#globalBlockStateRotations = blockStateDefs["rotations"]["*"];
			Object.entries(blockStateDefs["rotations"]["block_shapes"] ?? {}).forEach(([blockShapes, rotationDefs]) => {
				blockShapes.split(",").forEach(blockShape => {
					this.#blockShapeBlockStateRotations.set(blockShape, rotationDefs);
				});
			});
			Object.entries(blockStateDefs["rotations"]["block_names"] ?? {}).forEach(([blockNames, rotationDefs]) => {
				blockNames.split(",").forEach(blockName => {
					this.#blockNameBlockStateRotations.set(blockName, rotationDefs);
				});
			});

			this.#globalBlockStateTextureVariants = blockStateDefs["texture_variants"]["*"];
			Object.entries(blockStateDefs["texture_variants"]["block_shapes"] ?? {}).forEach(([blockShapes, textureVariantDefs]) => {
				blockShapes.split(",").forEach(blockShape => {
					this.#blockShapeBlockStateTextureVariants.set(blockShape, textureVariantDefs);
				});
			});
			Object.entries(blockStateDefs["texture_variants"]["block_names"] ?? {}).forEach(([blockNames, textureVariantDefs]) => {
				if (blockNames.startsWith("/") && blockNames.endsWith("/")) {
					this.#blockNamePatternBlockStateTextureVariants.push([new RegExp(blockNames.slice(1, -1)), textureVariantDefs]);
				} else {
					blockNames.split(",").forEach(blockName => {
						this.#blockNameBlockStateTextureVariants.set(blockName, textureVariantDefs);
					});
				}
			});
		}
		/**
		 * Makes poly mesh templates from a block palette.
		 * @param {Block[]} blockPalette
		 * @returns {PolyMeshTemplateFace[][]}
		 */
		makePolyMeshTemplates(blockPalette) {
			return blockPalette.map(block => this.#makePolyMeshTemplate(block));
		}
		/**
		 * Makes a poly mesh template (i.e. an array of poly mesh template faces) from a block. Texture UVs are unresolved, and are indices for the textureRefs property.
		 * @param {Block} block
		 * @returns {PolyMeshTemplateFace[]}
		 */
		#makePolyMeshTemplate(block) {
			let blockName = block["name"];
			let blockShape = this.#getBlockShape(blockName);
			let { faces, centerOfMass } = this.#makePolyMeshTemplateFaces(block, blockShape);
			if (!faces) {
				this.#console.debug(`No faces are being rendered for block ${blockName}`);
				return [];
			}
			blockShape = this.#extractNeoSpecialTexture(blockShape)?.blockShape ?? blockShape;
			let rotation = this.#getBlockRotation(block, blockShape);
			if (rotation) {
				faces.forEach(face => {
					face["normal"] = this.#applyEulerRotation(face["normal"], rotation, [0, 0, 0]);
					face["vertices"].forEach(vertex => {
						vertex["pos"] = this.#applyEulerRotation(vertex["pos"], rotation, [8, 8, 8]); // (8, 8, 8) is the block center and the pivot for all block-wide rotations
					});
				});
				centerOfMass = this.#applyEulerRotation(centerOfMass, rotation, [8, 8, 8]);
			}
			faces = this.#scaleFaces(faces, centerOfMass);
			faces.forEach(face => {
				if (face["fullbright"]) {
					face["normal"] = [0, 1, 0];
				} else {
					face["normal"] = vec3ToFixed(face["normal"], 4);
				}
				delete face["fullbright"];
			});
			return faces;
		}
		/**
		 * Gets the block shape for a specific block.
		 * @param {string} blockName
		 * @returns {string}
		 */
		#getBlockShape(blockName) {
			if (this.#cachedBlockShapes.has(blockName)) {
				return this.#cachedBlockShapes.get(blockName);
			}
			let individualBlockShape = this.#individualBlockShapes[blockName];
			if (individualBlockShape) {
				return individualBlockShape;
			}
			let matchingBlockShape = this.#blockShapePatterns.find(([pattern]) => pattern.test(blockName))?.[1]; // could use .filter to catch double matches but that's a skill issue
			let blockShape = matchingBlockShape ?? "block";
			this.#cachedBlockShapes.set(blockName, blockShape);
			return blockShape;
		}
		/**
		 * Makes the poly mesh faces for a block.
		 * @param {Block} block
		 * @param {string} blockShape
		 * @returns {{ faces?: (PolyMeshTemplateFace & { fullbright?: boolean })[], centerOfMass?: Vec3 }}
		 */
		#makePolyMeshTemplateFaces(block, blockShape) {
			let specialTexture;
			const neoSpecialTexture = this.#extractNeoSpecialTexture(blockShape);
			if (neoSpecialTexture) {
				blockShape = neoSpecialTexture.blockShape;
				specialTexture = neoSpecialTexture.texturePath;
			}

			let unfilteredCubes = structuredClone(this.#blockShapeGeos[blockShape]);
			if (!unfilteredCubes) {
				this.#console.error(`Could not find geometry for block shape ${blockShape}; defaulting to "block"`);
				unfilteredCubes = structuredClone(this.#blockShapeGeos["block"]);
			}
			let filteredCubes = [];
			let allFaces = [];
			while (unfilteredCubes.length) {
				// For each unfiltered cube, we add it to filteredCubes if we've checked the "if" flag. If there are copies, we then add them back to unfilteredCubes.
				let cube = unfilteredCubes.shift();
				if ("block_states" in cube) {
					let blockOverride = structuredClone(block);
					for (let blockStateName in cube["block_states"]) {
						if (typeof cube["block_states"][blockStateName] == "string") {
							cube["block_states"][blockStateName] = this.#interpolateInBlockValues(block, cube["block_states"][blockStateName], cube);
						}
					}
					blockOverride["states"] = { ...blockOverride["states"], ...cube["block_states"] };
					cube["block_override"] = blockOverride;
					delete cube["block_states"];
				}
				if ("if" in cube) {
					if (!this.#checkBlockStateConditional(cube["block_override"] ?? block, cube["if"])) {
						continue;
					}
					delete cube["if"];
				}
				if ("terrain_texture" in cube) {
					cube["terrain_texture"] = this.#interpolateInBlockValues(cube["block_override"] ?? block, cube["terrain_texture"], cube);
				}
				if ("copy" in cube) {
					if (cube["copy"] == blockShape) { // prevent recursion (sometimes)
						this.#console.error(`Cannot copy the same block shape: ${blockShape}`);
						continue;
					}
					let copiedCubes = structuredClone(this.#blockShapeGeos[cube["copy"]]);
					if (!copiedCubes) {
						this.#console.error(`Could not find geometry for block shape ${blockShape}; defaulting to "block"`);
						copiedCubes = structuredClone(this.#blockShapeGeos["block"]);
					}
					let fieldsToCopy = Object.keys(cube).filter(field => !["copy", "rot", "pivot", "translate"].includes(field));
					copiedCubes.forEach(copiedCube => {
						if ("translate" in cube) {
							copiedCube["translate"] = addVec3(copiedCube["translate"] ?? [0, 0, 0], cube["translate"]);
						}
						fieldsToCopy.forEach(field => { // copy all fields from this cube onto the new ones
							if (field == "flip_textures_horizontally" || field == "flip_textures_vertically") { // these ones are arrays but are supposed to represent sets, so we take the XOR/symmetric difference (ik there's a native method but it's very new)
								let facesInCopiedCube = new Set(copiedCube[field] ?? []);
								cube[field].forEach(face => {
									if (facesInCopiedCube.has(face)) {
										facesInCopiedCube.delete(face);
									} else {
										facesInCopiedCube.add(face);
									}
								});
								copiedCube[field] = Array.from(facesInCopiedCube);
							} else if (typeof copiedCube[field] == "object") {
								copiedCube[field] = { ...cube[field], ...copiedCube[field] }; // fields on the copied cubes still take priority over the "parent" cube (the one that's copying it)
							} else {
								copiedCube[field] ??= structuredClone(cube[field]);
							}
						});
						if ("rot" in cube) {
							if ("rot" in copiedCube) {
								// maths for combining both rotations is hard so we handle it differently and create a list of extra rotations.
								// HoloPrint.js will create a wrapper bone for each rotation
								copiedCube["extra_rots"] ??= [];
								copiedCube["extra_rots"].unshift({
									"rot": cube["rot"],
									"pivot": cube["pivot"] ?? [8, 8, 8]
								});
							} else {
								copiedCube["rot"] = cube["rot"];
								copiedCube["pivot"] = cube["pivot"] ?? copiedCube["pivot"];
							}
						}
					});
					unfilteredCubes.push(...copiedCubes);
				} else if ("copy_block" in cube) {
					let match = cube["copy_block"].match(/^entity\.(.+)$/);
					if (!match) {
						this.#console.error(`Incorrect formated copy_block property: ${match}`);
						continue;
					}
					let blockEntityProperty = match[1];
					let blockToCopy = block["block_entity_data"]?.[blockEntityProperty];
					if (!blockToCopy) {
						this.#console.error(`Cannot find block entity property ${blockEntityProperty} on block ${block["name"]}:`, block);
						continue;
					}
					blockToCopy["name"] = blockToCopy["name"].replace(/^minecraft:/, "");
					if (this.config.IGNORED_BLOCKS.includes(blockToCopy["name"])) {
						continue;
					}
					blockToCopy["#copied_via_copy_block"] = true; // I will learn rust if mojang adds this to the structure NBT
					let newBlockShape = this.#getBlockShape(blockToCopy["name"]);
					let { faces: newFaces } = this.#makePolyMeshTemplateFaces(blockToCopy, newBlockShape);
					if ("translate" in cube) {
						newFaces.forEach(face => {
							for (let i = 0; i < 4; i++) {
								face["vertices"][i]["pos"] = addVec3(face["vertices"][i]["pos"], cube["translate"]);
							}
						});
					}
					allFaces.push(...newFaces);
				} else {
					filteredCubes.push(cube);
				}
			}
			if (filteredCubes.length == 0) {
				return {};
			}
			// add easy property accessors. I could make a class if I wanted to
			filteredCubes.forEach(cube => {
				Object.defineProperties(cube, Object.fromEntries(["x", "y", "z", "w", "h", "d"].map((prop, i) => [prop, {
					get() {
						return (i < 3 ? this["pos"] : this["size"])[i % 3];
					},
					set(value) {
						(i < 3 ? this["pos"] : this["size"])[i % 3] = value;
					}
				}])));
			});
			let cubes = this.#optimizeGeometry(filteredCubes);
			cubes.sort((a, b) => a.w * a.h * a.d - b.w * b.h * b.d); // make larger cubes be rendered later. this helps for blocks like slime and honey where the inner cube has to be rendered before the outer cube

			let blockName = block["name"];
			let variant = this.#getTextureVariant(block);
			let variantWithoutEigenvariant;

			let allCubesAreFlat = true;
			cubes.forEach(cube => {
				let uv = this.#calculateUv(cube);

				// When the size of a cube in a direction is 0, we can remove all faces but 1. Because we have DisableCulling in the material, this single face will render from the back as well.
				// On a side note, if there wasn't the DisableCulling material state and we rendered both faces on opposite sides, the texture wouldn't be mirrored on the other side, so this is another bug fix ig
				if (cube.w == 0) {
					// 0 width: only render west
					["east", "down", "up", "north", "south"].forEach(faceName => delete uv[faceName]);
				}
				if (cube.h == 0) {
					// 0 height: only render down
					["west", "east", "up", "north", "south"].forEach(faceName => delete uv[faceName]);
				}
				if (cube.d == 0) {
					// 0 depth: only render north
					["west", "east", "down", "up", "south"].forEach(faceName => delete uv[faceName]);
				}

				let cubeVariant;
				if ("variant" in cube) {
					cubeVariant = cube["variant"];
				} else if (cube["ignore_eigenvariant"]) {
					if ("block_override" in cube) {
						cubeVariant = this.#getTextureVariant(cube["block_override"], true);
					} else {
						if (variantWithoutEigenvariant == undefined) {
							variantWithoutEigenvariant = this.#getTextureVariant(block, true);
						}
						cubeVariant = variantWithoutEigenvariant;
					}
				} else if ("block_override" in cube) {
					cubeVariant = this.#getTextureVariant(cube["block_override"]);
				} else {
					cubeVariant = variant; // default variant for this block
				}

				/** @type {(PolyMeshTemplateFace & { fullbright: boolean })[]} */
				let faces = [];
				let textureSize = cube["texture_size"] ?? [16, 16];
				// add generic keys to all faces, and convert texture references into indices
				Object.entries(uv).forEach(([faceName, face]) => {
					let isSideFace = ["west", "east", "north", "south"].includes(faceName);
					let textureFace = cube["textures"]?.[faceName] ?? (isSideFace ? cube["textures"]?.["side"] : undefined) ?? cube["textures"]?.["*"] ?? faceName;
					if (textureFace == "none") {
						return;
					}
					textureFace = this.#interpolateInBlockValues(cube["block_override"] ?? block, textureFace, cube);
					let textureRef = {
						"uv": face["uv"].map((x, i) => x / textureSize[i]),
						"uv_size": face["uv_size"].map((x, i) => x / textureSize[i]),
						"block_name": blockName,
						"texture_face": textureFace,
						"variant": cubeVariant
					};
					if (textureFace == "#tex") {
						if (specialTexture) {
							textureRef["texture_path_override"] = specialTexture;
						} else {
							this.#console.error(`No #tex for block ${blockName} and blockshape ${blockShape}!`);
						}
					} else if (/^textures\/.+[^/]$/.test(textureFace)) { // file path
						textureRef["texture_path_override"] = textureFace;
					} else {
						let terrainTextureOverride = cube["terrain_texture"];
						if (terrainTextureOverride) {
							delete textureRef["block_name"];
							delete textureRef["texture_face"];
							textureRef["terrain_texture_override"] = terrainTextureOverride;
						}
					}
					if ("texture_path_override" in textureRef) {
						delete textureRef["block_name"];
						delete textureRef["texture_face"];
						delete textureRef["variant"];
					}
					if ("tint" in cube) {
						let tint = cube["tint"];
						tint = this.#interpolateInBlockValues(cube["block_override"] ?? block, tint, cube);
						if (tint[0] == "#") {
							textureRef["tint"] = hexColorToClampedTriplet(tint);
						} else {
							// this is from cauldrons; colour is a 32-bit ARGB colour
							let colorCode = 2 ** 32 + Number(tint);
							textureRef["tint"] = [colorCode >> 16 & 0xFF, colorCode >> 8 & 0xFF, colorCode & 0xFF].map(x => x / 255);
						}
					}

					this.textureRefs.add(textureRef);
					let vertices = this.#getVertices(cube, faceName);
					let uvRot = cube["uv_rot"]?.[faceName] ?? (isSideFace ? cube["uv_rot"]?.["side"] : undefined) ?? cube["uv_rot"]?.["*"];
					if (uvRot) {
						while (uvRot >= 90) {
							[vertices[0]["corner"], vertices[1]["corner"], vertices[3]["corner"], vertices[2]["corner"]] = [vertices[2]["corner"], vertices[0]["corner"], vertices[1]["corner"], vertices[3]["corner"]];
							uvRot -= 90;
						}
						while (uvRot <= -90) {
							[vertices[2]["corner"], vertices[0]["corner"], vertices[1]["corner"], vertices[3]["corner"]] = [vertices[0]["corner"], vertices[1]["corner"], vertices[3]["corner"], vertices[2]["corner"]];
							uvRot += 90;
						}
					}
					let flipTextureHorizontally = cube["flip_textures_horizontally"]?.includes(faceName) ^ (isSideFace && cube["flip_textures_horizontally"]?.includes("side")) ^ cube["flip_textures_horizontally"]?.includes("*");
					let flipTextureVertically = cube["flip_textures_vertically"]?.includes(faceName) ^ (isSideFace && cube["flip_textures_vertically"]?.includes("side")) ^ cube["flip_textures_vertically"]?.includes("*");
					if ("box_uv" in cube) { // box uv does some flipping automatically
						flipTextureHorizontally ^= +(faceName != "north" && faceName != "south");
						flipTextureVertically ^= +(faceName == "up");
					}
					if (+(faceName == "down" || faceName == "up") ^ flipTextureHorizontally) { // in MC the down/up faces are rotated 180 degrees compared to how they are in geometry; this can be faked by flipping both axes.
						[vertices[0]["corner"], vertices[1]["corner"]] = [vertices[1]["corner"], vertices[0]["corner"]];
						[vertices[2]["corner"], vertices[3]["corner"]] = [vertices[3]["corner"], vertices[2]["corner"]];
					}
					if (+(faceName == "down" || faceName == "up") ^ flipTextureVertically) {
						[vertices[0]["corner"], vertices[2]["corner"]] = [vertices[2]["corner"], vertices[0]["corner"]];
						[vertices[1]["corner"], vertices[3]["corner"]] = [vertices[3]["corner"], vertices[1]["corner"]];
					}
					for (let i = 0; i < 4; i++) {
						let vertex = vertices[i];
						if ("rot" in cube) {
							vertex["pos"] = this.#applyEulerRotation(vertex["pos"], cube["rot"], cube["pivot"] ?? [8, 8, 8]);
						}
						cube["extra_rots"]?.reverse()?.forEach(extraRot => {
							vertex["pos"] = this.#applyEulerRotation(vertex["pos"], extraRot["rot"], extraRot["pivot"]);
						});
						if ("translate" in cube) {
							vertex["pos"] = addVec3(vertex["pos"], cube["translate"]);
						}
						if ("transform" in cube) {
							let transformed = mulMat4(cube["transform"], vertex["pos"]);
							let newPos = mulVec3([transformed[0], transformed[1], transformed[2]], 1 / transformed[3]);
							vertex["pos"] = newPos;
						}
					}
					faces.push({
						"normal": this.#getSurfaceNormal(vertices),
						"textureRefI": this.textureRefs.indexOf(textureRef),
						"vertices": vertices,
						"fullbright": Boolean(cube["fullbright"])
					});
				});
				if (faces.length == 1 && !("culled_faces" in cube)) {
					if (faces[0]["normal"][1] < 0) {
						faces[0]["normal"] = mulVec3(faces[0]["normal"], -1);
					}
				} else {
					allCubesAreFlat = false;
				}

				allFaces.push(...faces);
			});
			if (allCubesAreFlat) {
				allFaces.forEach(face => {
					face["fullbright"] = true; // blocks with only flat textures always appear at maximum brightness. source: me
				});
				this.#console.debug(`Making ${blockName} full bright!`);
			}
			let centerOfMass = this.#calculateCenterOfMass(cubes);
			return {
				faces: allFaces,
				centerOfMass
			};
		}
		/**
		 * Gets the block rotation for an entire block based on block states.
		 * @param {Block} block
		 * @param {string} blockShape
		 * @returns {Vec3 | null}
		 */
		#getBlockRotation(block, blockShape) {
			let blockName = block["name"];
			let blockShapeSpecificRotations = this.#blockShapeBlockStateRotations.get(blockShape);
			let blockNameSpecificRotations = this.#blockNameBlockStateRotations.get(blockName);
			let statesAndBlockEntityData = this.#getBlockStatesAndEntityDataEntries(block);
			let rotation = null;
			statesAndBlockEntityData.forEach(([blockStateName, blockStateValue]) => {
				let rotations = blockNameSpecificRotations?.[blockStateName] ?? blockShapeSpecificRotations?.[blockStateName] ?? this.#globalBlockStateRotations[blockStateName]; // order: block name (exact match), block shape, global
				if (!rotations) {
					return; // this block state doesn't control rotation
				}

				if (!(blockStateValue in rotations)) {
					this.#neoStateError(`Block state value ${blockStateValue} for rotation block state ${blockStateName} not found on ${blockName}...`, block);
					return;
				}
				if (rotation) {
					this.#console.debug(`Multiple rotation block states for block ${block["name"]}; adding them all together!`);
					rotation = addVec3(rotation, rotations[blockStateValue]);
				} else {
					rotation = rotations[blockStateValue];
				}
			});
			return rotation;
		}
		/**
		 * Applies Euler rotations on a position in 3D space in the order X-Y-Z.
		 * @param {Vec3} pos
		 * @param {Vec3} rotation Angles in degrees
		 * @param {Vec3} pivot
		 * @returns {Vec3}
		 */
		#applyEulerRotation(pos, rotation, pivot) {
			let res = addVec3(pos, mulVec3(pivot, -1));
			[res[1], res[2]] = rotateDeg([res[1], res[2]], -rotation[0]); // idk why but it's negative
			[res[0], res[2]] = rotateDeg([res[0], res[2]], -rotation[1]);
			[res[0], res[1]] = rotateDeg([res[0], res[1]], -rotation[2]);
			res = addVec3(res, pivot);
			return res;
		}
		/**
		 * Returns the entries of a block's states and block entity data (prefixed by `entity.`; only first-level properties are supported).
		 * @param {Block} block
		 * @returns {[string, any][]}
		 */
		#getBlockStatesAndEntityDataEntries(block) {
			return [...Object.entries(block["states"] ?? {}), ...Object.entries(block["block_entity_data"] ?? {}).map(([key, value]) => [`entity.${key}`, value])];
		}
		/**
		 * Optimises geometries by merging adjacent cubes and culling hidden faces.
		 * @param {object[]} cubes
		 * @returns {object[]}
		 */
		#optimizeGeometry(cubes) {
			let [unoptimizableCubes, optimizableCubes] = conditionallyGroup(cubes, cube => !("rot" in cube));
			optimizableCubes.forEach(cube => {
				if ("translate" in cube) {
					cube["pos"] = addVec3(cube["pos"], cube["translate"]);
				}
			});
			let mergeableGroups = new Map(optimizableCubes.map(cube => [cube, this.#getMergingGroup(cube)]));

			let mergedCubes = [];
			optimizableCubes.forEach(cube1 => { // this is the cube we're trying to add to mergedCubes
				tryMerging: while (true) {
					for (let [i, cube2] of mergedCubes.entries()) {
						let mergeable = mergeableGroups.get(cube1) == mergeableGroups.get(cube2);
						if (this.#tryMergeCubesOneWayAndCullFaces(cube1, cube2, mergeable)) {
							this.#console.debug("Merged cube", cube2, "into", cube1);
							Object.entries(cube1["culled_faces"] ?? {}).forEach(([faceName, preCullingValue]) => {
								if (preCullingValue) {
									cube1["textures"][faceName] = preCullingValue;
								} else {
									delete cube1["textures"][faceName];
								}
							});
							delete cube1["culled_faces"];
							mergedCubes.splice(i, 1);
							continue tryMerging; // since boneCube1 has been mutated, this stops the current comparison of boneCube1 with the already merged cubes, and makes it start again.
						} else if (this.#tryMergeCubesOneWayAndCullFaces(cube2, cube1, mergeable)) {
							this.#console.debug("Merged cube", cube1, "into", cube2);
							Object.entries(cube2["culled_faces"] ?? {}).forEach(([faceName, preCullingValue]) => {
								if (preCullingValue) {
									cube2["textures"][faceName] = preCullingValue;
								} else {
									delete cube2["textures"][faceName];
								}
							});
							delete cube2["culled_faces"];
							mergedCubes.splice(i, 1);
							cube1 = cube2;
							continue tryMerging; // boneCube2 has been mutated, so we removed it from mergedCubes and swap it out for boneCube1, then restart trying to merge it.
						}
					}
					break; // we'll only get to here when it's checked all combinations between the already merged cubes and the new cube (cube1)
				}
				mergedCubes.push(cube1);
			});
			mergedCubes.forEach(cube => {
				if ("translate" in cube) {
					cube["pos"] = subVec3(cube["pos"], cube["translate"]);
				}
			});

			return [...unoptimizableCubes, ...mergedCubes];
		}
		/**
		 * Returns a "merging group" for a cube. Cubes in the same merging group can be merged together. It doesn't affect face culling.
		 * @param {object} cube
		 * @returns {number | string}
		 */
		#getMergingGroup(cube) {
			if (cube["disable_merging"] || "translate" in cube || "uv" in cube || "uv_sizes" in cube || "uv_rot" in cube || "box_uv" in cube) {
				return NaN; // in JS, NaN == NaN is false, disabling these cubes from being merged at all
			} else {
				return JSON.stringify([cube["id"], cube["textures"], cube["texture_size"], cube["block_override"], cube["terrain_texture"], cube["variant"], cube["ignore_eigenvariant"], cube["tint"], cube["fullbright"], cube["flip_textures_horizontally"], cube["flip_textures_vertically"], cube["arrays"], cube["neo_special_texture"]]); // these are all the properties that could exist on a cube at this point - basically, two cubes have to be identical in all of these in order to be mergeable
			}
		}
		/**
		 * Unpurely tries to merge the second cube into the first if it is positively adjacent, and culls hidden faces if they are touching.
		 * @param {object} cube1
		 * @param {object} cube2
		 * @param {boolean} mergeable If the cubes can be merged
		 * @returns {boolean} If the second cube was merged into the first.
		 */
		#tryMergeCubesOneWayAndCullFaces(cube1, cube2, mergeable) {
			if (cube1.x + cube1.w == cube2.x) { // cube 2 is to the right of cube 1
				if (mergeable && cube1.y == cube2.y && cube1.z == cube2.z && cube1.h == cube2.h && cube1.d == cube2.d) {
					cube1.w += cube2.w; // grow cube 1...
					return true;
				}
			} else if (cube1.y + cube1.h == cube2.y) { // cube 2 is above cube 1
				if (mergeable && cube1.x == cube2.x && cube1.z == cube2.z && cube1.w == cube2.w && cube1.d == cube2.d) {
					cube1.h += cube2.h;
					return true;
				}
			} else if (cube1.z + cube1.d == cube2.z) { // cube 2 is behind cube 1
				if (mergeable && cube1.x == cube2.x && cube1.y == cube2.y && cube1.w == cube2.w && cube1.h == cube2.h) {
					cube1.d += cube2.d;
					return true;
				}
			}
			if (cube1.w == 0 || cube1.h == 0 || cube1.d == 0 || cube2.w == 0 || cube2.h == 0 || cube2.d == 0) {
				return false; // don't cull flat cubes
			}
			if (cube1.x < cube2.x && cube1.x + cube1.w >= cube2.x && cube1.x + cube1.w <= cube2.x + cube2.w) {
				if (cube1.y >= cube2.y && cube1.y + cube1.h <= cube2.y + cube2.h && cube1.z >= cube2.z && cube1.z + cube1.d <= cube2.z + cube2.d) { // right face of cube1 fits within left face of cube2
					cube1["textures"] ??= {};
					if (cube1["textures"]["west"] != "none") {
						cube1["culled_faces"] ??= {};
						cube1["culled_faces"]["west"] = cube1["textures"]["west"]; // keep track of faces which were culled. this is so if the cubes are merged, they reset to before the faces were culled; and so if all faces but one are culled, the proper shading can be applied
					}
					cube1["textures"]["west"] = "none";
				}
				if (cube2.y >= cube1.y && cube2.y + cube2.h <= cube1.y + cube1.h && cube2.z >= cube1.z && cube2.z + cube2.d <= cube1.z + cube1.d) { // left face of cube2 fits within right face of cube1
					cube2["textures"] ??= {};
					if (cube2["textures"]["east"] != "none") {
						cube2["culled_faces"] ??= {};
						cube2["culled_faces"]["east"] = cube2["textures"]["east"]; // keep track of faces which were culled. this is so if the cubes are merged, they reset to before the faces were culled; and so if all faces but one are culled, the proper shading can be applied
					}
					cube2["textures"]["east"] = "none";
				}
			}
			if (cube1.y < cube2.y && cube1.y + cube1.h >= cube2.y && cube1.y + cube1.h <= cube2.y + cube2.h) {
				if (cube1.x >= cube2.x && cube1.x + cube1.w <= cube2.x + cube2.w && cube1.z >= cube2.z && cube1.z + cube1.d <= cube2.z + cube2.d) { // top face of cube1 fits within bottom face of cube2
					cube1["textures"] ??= {};
					if (cube1["textures"]["up"] != "none") {
						cube1["culled_faces"] ??= {};
						cube1["culled_faces"]["up"] = cube1["textures"]["up"]; // keep track of faces which were culled. this is so if the cubes are merged, they reset to before the faces were culled; and so if all faces but one are culled, the proper shading can be applied
					}
					cube1["textures"]["up"] = "none";
				}
				if (cube2.x >= cube1.x && cube2.x + cube2.w <= cube1.x + cube1.w && cube2.z >= cube1.z && cube2.z + cube2.d <= cube1.z + cube1.d) { // bottom face of cube2 fits within top face of cube1
					cube2["textures"] ??= {};
					if (cube2["textures"]["down"] != "none") {
						cube2["culled_faces"] ??= {};
						cube2["culled_faces"]["down"] = cube2["textures"]["down"]; // keep track of faces which were culled. this is so if the cubes are merged, they reset to before the faces were culled; and so if all faces but one are culled, the proper shading can be applied
					}
					cube2["textures"]["down"] = "none";
				}
			}
			if (cube1.z < cube2.z && cube1.z + cube1.d >= cube2.z && cube1.z + cube1.d <= cube2.z + cube2.d) {
				if (cube1.x >= cube2.x && cube1.x + cube1.w <= cube2.x + cube2.w && cube1.y >= cube2.y && cube1.y + cube1.h <= cube2.y + cube2.h) { // back face of cube1 fits within front face of cube2
					cube1["textures"] ??= {};
					if (cube1["textures"]["south"] != "none") {
						cube1["culled_faces"] ??= {};
						cube1["culled_faces"]["south"] = cube1["textures"]["south"]; // keep track of faces which were culled. this is so if the cubes are merged, they reset to before the faces were culled; and so if all faces but one are culled, the proper shading can be applied
					}
					cube1["textures"]["south"] = "none";
				}
				if (cube2.x >= cube1.x && cube2.x + cube2.w <= cube1.x + cube1.w && cube2.y >= cube1.y && cube2.y + cube2.h <= cube1.y + cube1.h) { // front face of cube2 fits within back face of cube1
					cube2["textures"] ??= {};
					if (cube2["textures"]["north"] != "none") {
						cube2["culled_faces"] ??= {};
						cube2["culled_faces"]["north"] = cube2["textures"]["north"]; // keep track of faces which were culled. this is so if the cubes are merged, they reset to before the faces were culled; and so if all faces but one are culled, the proper shading can be applied
					}
					cube2["textures"]["north"] = "none";
				}
			}
			return false;
		}
		/**
		 * Gets the index of the variant to use in terrain_texture.json for a block.
		 * @param {Block} block
		 * @param {boolean} [ignoreEigenvariant]
		 * @returns {number}
		 */
		#getTextureVariant(block, ignoreEigenvariant = false) {
			let blockName = block["name"];
			let eigenvariantExists = blockName in this.#eigenvariants;
			if (!ignoreEigenvariant && eigenvariantExists) {
				let variant = this.#eigenvariants[blockName];
				this.#console.debug(`Using eigenvariant ${variant} for block ${blockName}`);
				return variant;
			} else if (ignoreEigenvariant && !eigenvariantExists) {
				this.#console.warn(`Cannot ignore eigenvariant of ${blockName} as it doesn't exist!`);
			}

			if (!("states" in block || "block_entity_data" in block)) {
				return -1;
			}
			let blockShape = this.#getBlockShape(blockName); // In copied block shapes, we want to look at the original block shape's texture variants, not the copied's. E.g. With candle_cake, we don't want the cake that is copied to look at the texture variants for cake (which includes bite_counter).
			let statesAndBlockEntityData = this.#getBlockStatesAndEntityDataEntries(block);
			let blockShapeSpecificVariants = this.#blockShapeBlockStateTextureVariants.get(blockShape);
			if (blockShapeSpecificVariants?.["#exclusive_add"]) {
				let variant = 0;
				statesAndBlockEntityData.forEach(([blockStateName, blockStateValue]) => {
					if (blockStateName in blockShapeSpecificVariants) {
						let blockStateVariants = blockShapeSpecificVariants[blockStateName];
						if (!(blockStateValue in blockStateVariants)) {
							this.#neoStateError(`Block state value ${blockStateValue} for texture-variating block state ${blockStateName} not found on ${blockName}...`, block);
							return;
						}
						variant += blockStateVariants[blockStateValue];
					}
				});
				return variant;
			}
			let blockNameSpecificVariants = this.#blockNameBlockStateTextureVariants.get(blockName) ?? this.#blockNamePatternBlockStateTextureVariants.find(([pattern]) => pattern.test(blockName))?.[1];
			if (blockNameSpecificVariants?.["#exclusive_add"]) {
				let variant = 0;
				statesAndBlockEntityData.forEach(([blockStateName, blockStateValue]) => {
					if (blockStateName in blockNameSpecificVariants) {
						let blockStateVariants = blockNameSpecificVariants[blockStateName];
						if (!(blockStateValue in blockStateVariants)) {
							this.#neoStateError(`Block state value ${blockStateValue} for texture-variating block state ${blockStateName} not found...`);
							return;
						}
						variant += blockStateVariants[blockStateValue];
					}
				});
				return variant;
			}
			let variant = -1;
			statesAndBlockEntityData.forEach(([blockStateName, blockStateValue]) => {
				let blockStateVariants = blockNameSpecificVariants?.[blockStateName] ?? blockShapeSpecificVariants?.[blockStateName] ?? this.#globalBlockStateTextureVariants[blockStateName];
				if (blockStateVariants == undefined) {
					return;
				}

				if (!(blockStateValue in blockStateVariants)) {
					this.#neoStateError(`Block state value ${blockStateValue} for texture-variating block state ${blockStateName} not found...`);
					return;
				}
				let newVariant = blockStateVariants[blockStateValue];
				if (variant != -1) {
					this.#console.warn(`Multiple texture-variating block states for block ${block["name"]}; using ${blockStateName}`);
				}
				variant = newVariant;
			});
			return variant;
		}
		/**
		 * Calculates the UV for a cube.
		 * @param {object} cube
		 * @returns {CubeUv}
		 */
		#calculateUv(cube) {
			if ("box_uv" in cube) { // this is where a singular uv coordinate is specified, and the rest is calculated as below. used primarily in entity models.
				let boxUvSize = cube["box_uv_size"] ?? cube["size"];
				/** @type {CubeUv} */
				let uv = {
					"up": {
						"uv": [boxUvSize[2], 0],
						"uv_size": [boxUvSize[0], boxUvSize[2]]
					},
					"down": {
						"uv": [boxUvSize[0] + boxUvSize[2], 0],
						"uv_size": [boxUvSize[0], boxUvSize[2]]
					},
					"west": {
						"uv": [0, boxUvSize[2]],
						"uv_size": [boxUvSize[2], boxUvSize[1]]
					},
					"north": {
						"uv": [boxUvSize[2], boxUvSize[2]],
						"uv_size": [boxUvSize[0], boxUvSize[1]]
					},
					"east": {
						"uv": [boxUvSize[0] + boxUvSize[2], boxUvSize[2]],
						"uv_size": [boxUvSize[2], boxUvSize[1]]
					},
					"south": {
						"uv": [boxUvSize[0] + boxUvSize[2] * 2, boxUvSize[2]],
						"uv_size": [boxUvSize[0], boxUvSize[1]]
					}
				};
				Object.values(uv).forEach(face => {
					face["uv"] = addVec2(face["uv"], cube["box_uv"]);
				});
				return uv;
			} else {
				// In MCBE most non-full-block textures look at where the part that is being rendered is in relation to the entire cube space it's in - like it's being projected onto a full face then cut out. Kinda hard to explain sorry, I recommend messing around with fence textures so you understand how it works.
				let westUvOffset = [cube.z, 16 - cube.y - cube.h];
				let eastUvOffset = [16 - cube.z - cube.d, 16 - cube.y - cube.h];
				let downUvOffset = [16 - cube.x - cube.w, 16 - cube.z - cube.d];
				let upUvOffset = [16 - cube.x - cube.w, cube.z];
				let northUvOffset = [cube.x, 16 - cube.y - cube.h];
				let southUvOffset = [16 - cube.x - cube.w, 16 - cube.y - cube.h];
				return {
					"west": {
						"uv": cube["uv"]?.["west"] ?? cube["uv"]?.["side"] ?? cube["uv"]?.["*"] ?? westUvOffset,
						"uv_size": cube["uv_sizes"]?.["west"] ?? cube["uv_sizes"]?.["side"] ?? cube["uv_sizes"]?.["*"] ?? [cube.d, cube.h]
					},
					"east": {
						"uv": cube["uv"]?.["east"] ?? cube["uv"]?.["side"] ?? cube["uv"]?.["*"] ?? eastUvOffset,
						"uv_size": cube["uv_sizes"]?.["east"] ?? cube["uv_sizes"]?.["side"] ?? cube["uv_sizes"]?.["*"] ?? [cube.d, cube.h]
					},
					"down": {
						"uv": cube["uv"]?.["down"] ?? cube["uv"]?.["*"] ?? downUvOffset,
						"uv_size": cube["uv_sizes"]?.["down"] ?? cube["uv_sizes"]?.["*"] ?? [cube.w, cube.d]
					},
					"up": {
						"uv": cube["uv"]?.["up"] ?? cube["uv"]?.["*"] ?? upUvOffset,
						"uv_size": cube["uv_sizes"]?.["up"] ?? cube["uv_sizes"]?.["*"] ?? [cube.w, cube.d]
					},
					"north": {
						"uv": cube["uv"]?.["north"] ?? cube["uv"]?.["side"] ?? cube["uv"]?.["*"] ?? northUvOffset,
						"uv_size": cube["uv_sizes"]?.["north"] ?? cube["uv_sizes"]?.["side"] ?? cube["uv_sizes"]?.["*"] ?? [cube.w, cube.h]
					},
					"south": {
						"uv": cube["uv"]?.["south"] ?? cube["uv"]?.["side"] ?? cube["uv"]?.["*"] ?? southUvOffset,
						"uv_size": cube["uv_sizes"]?.["south"] ?? cube["uv_sizes"]?.["side"] ?? cube["uv_sizes"]?.["*"] ?? [cube.w, cube.h]
					}
				};
			}
		}
		/**
		 * Gets the default vertices for a cube and a specific face side.
		 * @param {object} cube
		 * @param {Data.CardinalDirection} faceName
		 * @returns {[PolyMeshTemplateVertex, PolyMeshTemplateVertex, PolyMeshTemplateVertex, PolyMeshTemplateVertex]}
		 */
		#getVertices(cube, faceName) {
			let { pos, size } = cube;
			const cubeFaces = {
				"west": tuple([[1, 1, 0], [1, 1, 1], [1, 0, 0], [1, 0, 1]]),
				"east": tuple([[0, 1, 1], [0, 1, 0], [0, 0, 1], [0, 0, 0]]),
				"down": tuple([[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]]),
				"up": tuple([[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]]),
				"north": tuple([[0, 1, 0], [1, 1, 0], [0, 0, 0], [1, 0, 0]]),
				"south": tuple([[1, 1, 1], [0, 1, 1], [1, 0, 1], [0, 0, 1]])
			};
			return cubeFaces[faceName].map(([a, b, c], i) => {
				return {
					"pos": tuple([pos[0] + size[0] * a, pos[1] + size[1] * b, pos[2] + size[2] * c]),
					"corner": i
				};
			});
		}
		/**
		 * Gets the surface normal for a specific face of a cube.
		 * @param {[PolyMeshTemplateVertex, PolyMeshTemplateVertex, PolyMeshTemplateVertex, PolyMeshTemplateVertex]} vertices
		 * @returns {Vec3}
		 */
		#getSurfaceNormal(vertices) {
			let dir1 = subVec3(vertices[1]["pos"], vertices[0]["pos"]);
			let dir2 = subVec3(vertices[2]["pos"], vertices[0]["pos"]);
			let normal = normalizeVec3(crossProduct(dir1, dir2));
			return normal;
		}
		/**
		 * Calculates the center of mass of some cubes, assuming mass = volume. If all cubes are flat it will take surface area for mass.
		 * @param {object[]} cubes
		 * @returns {Vec3}
		 */
		#calculateCenterOfMass(cubes) {
			let center = tuple([0, 0, 0]);
			let totalMass = 0;
			cubes.forEach(cube => {
				let mass = cube.w * cube.h * cube.d; // assume uniform mass density
				totalMass += mass;
				let cubeCenter = addVec3(cube["pos"], mulVec3(cube["size"], 0.5));
				if ("rot" in cube) {
					cubeCenter = this.#applyEulerRotation(cubeCenter, cube["rot"], cube["pivot"] ?? [8, 8, 8]);
				}
				center = addVec3(center, mulVec3(cubeCenter, mass));
			});
			if (totalMass == 0) { // all cubes must be flat
				cubes.forEach(cube => {
					let mass = max(cube.w, 1) * max(cube.h, 1) * max(cube.d, 1);
					totalMass += mass;
					let cubeCenter = addVec3(cube["pos"], mulVec3(cube["size"], 0.5));
					if ("rot" in cube) {
						cubeCenter = this.#applyEulerRotation(cubeCenter, cube["rot"], cube["pivot"] ?? [8, 8, 8]);
					}
					center = addVec3(center, mulVec3(cubeCenter, mass));
				});
			}
			if (totalMass == 0) {
				this.#console.error("0 mass...");
				return [8, 8, 8];
			}
			center = mulVec3(center, 1 / totalMass);
			return center;
		}
		/**
		 * Scales poly mesh templates faces towards a center of mass.
		 * @param {PolyMeshTemplateFace[]} faces
		 * @param {Vec3} centerOfMass
		 * @returns {PolyMeshTemplateFace[]}
		 */
		#scaleFaces(faces, centerOfMass) {
			return faces.map(face => {
				for (let i = 0; i < 4; i++) {
					let v = face["vertices"][i];
					let translated = addVec3(v["pos"], mulVec3(centerOfMass, -1));
					v["pos"] = addVec3(mulVec3(translated, this.config.SCALE), centerOfMass); // I long for the day when ECMAScript has native vector types like in GLSL. This is equivalent to (v["pos"] - centerOfMass) * scale + centerOfMass
				}
				return face;
			});
		}
		#checkBlockStateConditional(block, conditional, stateCandidates = new Map()) {
			let trimmedConditional = conditional.replaceAll(/\s/g, "");
			let booleanOperations = trimmedConditional.match(/&&|\|\|/g) ?? []; // can have multiple separated by ?? or ||
			let booleanValues = trimmedConditional.split(/&&|\|\|/).map(booleanExpression => {
				if (booleanExpression == "#copied_via_copy_block") {
					return block["#copied_via_copy_block"] === true;
				} else if (booleanExpression == "!#copied_via_copy_block") {
					return block["#copied_via_copy_block"] !== true;
				}
				let match = booleanExpression.match(/^((?:entity\.)?[\w:&-?]+)(==|>|<|>=|<=|!=)(-?\w+)$/); // Despite the Minecraft Wiki and Microsoft creator documentation saying there can be boolean block states, they're stored as bytes in NBT
				if (!match) {
					this.#neoStateError(`Incorrectly formatted block state expression "${booleanExpression}" from conditional "${conditional}"\n(Match: ${JSON.stringify(match)})`);
					return true; // If we miss the error message more geometry will draw more attention to it :D
				}
				let [, blockStateTerm, comparisonOperator, expectedBlockState] = match;
				let blockStateOperation = blockStateTerm.match(/^(entity\.)?([\w:]+)(?:(\?\?|&)(-?\d+))?$/);
				if (!blockStateOperation) {
					this.#neoStateError(`Incorrectly formed block state term: ${blockStateTerm}`);
					return true;
				}
				let [, usingBlockEntityData, blockStateName, blockStateOperator, blockStateOperandString] = blockStateOperation;
				let dataObjectName = usingBlockEntityData ? "block_entity_data" : "states";
				if (!(dataObjectName in block)) {
					this.#neoStateError(`No ${dataObjectName} in block ${block["name"]}!`);
					return true;
				}
				let dataObject = block[dataObjectName];
				if (blockStateOperator != "??" && !(blockStateName in dataObject)) {
					this.#neoStateError(`Cannot find ${dataObjectName} ${blockStateName} on block ${block["name"]}`);
					return true;
				}
				let actualBlockState = dataObject[blockStateName];
				// let candidateKey = usingBlockEntityData ? `entity.${blockStateName}` : blockStateName;
				// let candidates = stateCandidates.get(candidateKey);
				// if (candidates?.size > 1 && actualBlockState != undefined && !candidates.has(String(actualBlockState))) {
				// 	this.#neoStateError(`Invalid ${dataObjectName} ${blockStateName} value ${actualBlockState} on block ${block["name"]}`);
				// 	return true;
				// }
				// fail-open mode is only enabled for debugging

				if (blockStateOperator) {
					let blockStateOperand = Number(blockStateOperandString);
					if (Number.isNaN(blockStateOperand)) {
						this.#neoStateError(`${dataObjectName} operand ${blockStateOperand} is not a number!`);
						return true;
					}
					actualBlockState = function () {
						switch (blockStateOperator) {
							case "&": return actualBlockState & blockStateOperand;
							case "??": return actualBlockState ?? blockStateOperand;
						}
						this.#neoStateError(`Unknown ${dataObjectName} operator ${blockStateOperator} in term ${blockStateTerm}!`);
						return actualBlockState;
					}();
				}

				switch (comparisonOperator) {
					case "==": return actualBlockState == expectedBlockState;
					case ">": return actualBlockState > expectedBlockState;
					case "<": return actualBlockState < expectedBlockState;
					case ">=": return actualBlockState >= expectedBlockState;
					case "<=": return actualBlockState <= expectedBlockState;
					case "!=": return actualBlockState != expectedBlockState;
				}
				this.#neoStateError(`Unknown ${dataObjectName} comparison operator ${comparisonOperator} in expression ${booleanExpression}`);
				return true;
			});

			// do && before || to match JS operator precedence
			let andRes = [booleanValues[0]];
			booleanOperations.forEach((booleanOperation, i) => {
				if (booleanOperation == "&&") {
					andRes[andRes.length - 1] &&= booleanValues[i + 1];
				} else {
					andRes.push(booleanValues[i + 1])
				}
			});
			let orRes = andRes.some(x => x); // only || operations remain
			return orRes;
		}
		/**
		 * Substitutes values from a block into a particular expression.
		 * @param {Block} block
		 * @param {string} fullExpression
		 * @param {object} cube
		 * @returns {string}
		 */
		#interpolateInBlockValues(block, fullExpression, cube) {
			let wholeStringValue;
			let substitutedExpression = fullExpression.replaceAll(/\${([^}]+)}/g, (bracketedExpression, expression) => {
				if (wholeStringValue != undefined) return;
				if (/^Array\.\w+\[[^\[]+\]$/.test(expression)) {
					let [, arrayName, arrayIndexVar] = expression.match(/^Array\.(\w+)\[([^\[]+)\]$/);
					let array = cube["arrays"]?.[arrayName];
					if (!array) {
						this.#neoStateError(`Couldn't find array ${arrayName} in cube:`, cube);
						return "";
					}
					let arrayIndex;
					if (arrayIndexVar.startsWith("entity.")) {
						let blockEntityProperty = arrayIndexVar.slice(7);
						if (!("block_entity_data" in block) || !(blockEntityProperty in block["block_entity_data"])) {
							this.#neoStateError(`Cannot find block entity property ${blockEntityProperty} in ${block["name"]}:`, block);
							return "";
						}
						arrayIndex = block["block_entity_data"][blockEntityProperty];
					} else {
						if (!("states" in block) || !(arrayIndexVar in block["states"])) {
							this.#neoStateError(`Cannot find block state ${arrayIndexVar} in ${block["name"]}:`, block);
							return "";
						}
						arrayIndex = block["states"][arrayIndexVar];
					}
					if (!(arrayIndex in array)) {
						this.#neoStateError(`Array index out of bounds: ${JSON.stringify(array)}[${arrayIndex}]`);
						return "";
					}
					return array[arrayIndex];
				}
				let match = expression.replaceAll(/\s/g, "").match(/^(#block_name|#block_states|#block_entity_data)((?:\.\w+|\[-?\d+\])*)(\[(-?\d+):(-?\d*)\]|\[:(-?\d+)\])?(?:\?\?(.+))?$/);
				if (!match) {
					this.#neoStateError(`Wrongly formatted expression: ${bracketedExpression}`);
					return "";
				}
				let [, specialVar, propertyChain, ...slicingAndDefault] = match;
				let value = function () {
					switch (specialVar) {
						case "#block_name": return block["name"];
						case "#block_states": return block["states"];
						case "#block_entity_data": return block["block_entity_data"];
					}
					this.#neoStateError(`Unknown special variable: ${specialVar}`);
				}();
				propertyChain.match(/\.\w+|\[-?\d+\]/g)?.forEach(property => {
					let keys = property.match(/^\.(\w+)|\[(\d+)\]$/);
					value = value?.[keys[1] ?? keys[2]];
				});
				if (slicingAndDefault[0] != undefined) {
					value = value?.slice(slicingAndDefault[1], slicingAndDefault[3] ?? (slicingAndDefault[2] == "" ? undefined : slicingAndDefault[2]));
				}
				if (value == undefined || value === "") {
					if (slicingAndDefault[4] != undefined) {
						let defaultValue = slicingAndDefault[4];
						if (/SET_WHOLE_STRING\([^)]+\)/.test(defaultValue)) {
							wholeStringValue = defaultValue.match(/\(([^)]+)\)/)[1];
							return;
						} else {
							value = defaultValue;
						}
					} else {
						this.#neoStateError(`Nothing for ${specialVar}${propertyChain} in block:`, block);
						return "";
					}
				}
				this.#console.debug(`Changed ${bracketedExpression} to ${value}!`, block);
				return value;
			});
			return wholeStringValue ?? substitutedExpression;
		}

		// ---- neoHoloprintDB instrumentation layer ----
		// The methods below are inserted into the copied HoloPrint core. They reuse the
		// original private helpers above, but stop before poly_mesh and atlas packing.
		setResourceMetadata(blocksJson, terrainTextureJson, packName = null) {
			this.blocksJson = blocksJson ?? null;
			this.terrainTextureJson = terrainTextureJson ?? null;
			this.loadedPackName = packName;
		}

		getVariantDescriptorTemplate(blockName) {
			const normalized = neoNormalizeBlockName(blockName);
			let blockShape = this.#getBlockShape(normalized);
			const specialTexture = this.#extractNeoSpecialTexture(blockShape);
			if (specialTexture) blockShape = specialTexture.blockShape;
			const template = {
				"block_name": normalized,
				"block_shape": blockShape,
				"special_texture": specialTexture?.texturePath ?? "",
				"states": {},
				"block_entity_data": {}
			};
			this.#collectNeoShapeRequirements(template, blockShape, new Set());
			this.#collectNeoStateDefinitionRequirements(template, normalized, blockShape);
			return template;
		}

		getBlockBoxes(blockName, descriptor = {}, options = {}) {
			const block = this.#descriptorToNeoBlock(blockName, descriptor);
			const cullInternalFaces = options["cullInternalFaces"] ?? descriptor?.["options"]?.["cullInternalFaces"] ?? false;
			const strictBlockStateErrors = options["strictBlockStateErrors"] ?? descriptor?.["options"]?.["strictBlockStateErrors"] ?? false;
			const previousStrictBlockStateErrors = this.#neoStrictBlockStateErrors;
			this.#neoStrictBlockStateErrors = strictBlockStateErrors;
			try {
				let blockShape = this.#getBlockShape(block["name"]);
				const specialTexture = this.#extractNeoSpecialTexture(blockShape);
				if (specialTexture) blockShape = specialTexture.blockShape;
				const boxes = this.#makeNeoBoxes(block, blockShape, specialTexture?.texturePath, new Set(), cullInternalFaces, strictBlockStateErrors);
				const blockRotation = this.#getBlockRotation(block, blockShape);
				return boxes.map((box, i) => {
					box["variant"] = this.#getTextureVariant(box["block_override"] ?? block, Boolean(box["ignore_eigenvariant"]));
					const out = {
						"id": this.#getNeoBoxId(box),
						"index": i,
						"block_name": block["name"],
						"block_shape": blockShape,
						"pos": this.#getNeoOutputBoxPos(box),
						"size": box["size"] ? neoClone(box["size"]) : null,
						"tex": this.#resolveNeoBoxTextures(block, box, specialTexture?.texturePath),
						"uv": this.#resolveNeoBoxUvs(block, box)
					};
					["rot", "pivot", "translate", "transform", "extra_rots"].forEach(key => {
						if (key in box) out[key] = neoClone(box[key]);
					});
					out["box_rotation"] = this.#getNeoBoxRotation(box);
					out["state_rotation"] = this.#getNeoStateRotation(blockRotation);
					return out;
				});
			} finally {
				this.#neoStrictBlockStateErrors = previousStrictBlockStateErrors;
			}
		}

		#neoStateError(...args) {
			if (this.#neoStrictBlockStateErrors) this.#console.error(...args);
		}

		#getNeoBoxId(box) {
			return box?.["id"] == undefined ? "" : String(box["id"]);
		}

		#getNeoOutputBoxPos(box) {
			if (!box["pos"]) return null;
			return neoClone(box["pos"]);
		}

		#getNeoBoxRotation(box) {
			if (!box || !("rot" in box || "pivot" in box || "extra_rots" in box)) return null;
			return {
				"rot": box["rot"] ? neoClone(box["rot"]) : null,
				"pivot": neoClone(box["pivot"] ?? [8, 8, 8]),
				"extra_rots": box["extra_rots"] ? neoClone(box["extra_rots"]) : []
			};
		}

		#getNeoStateRotation(blockRotation) {
			if (!blockRotation) return null;
			return {
				"rot": neoClone(blockRotation),
				"pivot": [8, 8, 8]
			};
		}

		#descriptorToNeoBlock(blockName, descriptor) {
			const sourceStates = descriptor?.["states"] ?? descriptor?.["block_states"] ?? {};
			const sourceEntity = descriptor?.["block_entity_data"] ?? descriptor?.["entity_data"] ?? {};
			const states = {};
			const entityData = {};
			Object.entries(sourceStates).forEach(([key, entry]) => {
				const value = entry && typeof entry == "object" && !Array.isArray(entry) && "value" in entry ? entry["value"] : entry;
				if (value !== undefined && value !== null && value !== "") states[key] = value;
			});
			Object.entries(sourceEntity).forEach(([key, entry]) => {
				const value = entry && typeof entry == "object" && !Array.isArray(entry) && "value" in entry ? entry["value"] : entry;
				if (value !== undefined && value !== null && value !== "") entityData[key] = value;
			});
			return { "name": neoNormalizeBlockName(blockName), "states": states, "block_entity_data": entityData };
		}

		#extractNeoSpecialTexture(blockShape) {
			const match = String(blockShape).match(/^(?:(\w+)\{(textures\/[\w\/]+)\}|(\w+)<(textures\/[\w\/]+)>)$/);
			return match ? { "blockShape": match[1] ?? match[3], "texturePath": match[2] ?? match[4] } : "";
		}

		#makeNeoBoxes(block, blockShape, specialTexture, recursionGuard, cullInternalFaces = false, strictBlockStateErrors = false) {
			if (recursionGuard.has(blockShape)) return [];
			recursionGuard.add(blockShape);
			let unfilteredCubes = structuredClone(this.#blockShapeGeos[blockShape] ?? this.#blockShapeGeos["block"] ?? []);
			let stateCandidates = this.#collectNeoRuntimeStateCandidates(unfilteredCubes, new Set([blockShape]));
			let filteredCubes = [];
			while (unfilteredCubes.length) {
				let cube = unfilteredCubes.shift();
				if ("block_states" in cube) {
					let blockOverride = structuredClone(block);
					for (let blockStateName in cube["block_states"]) {
						if (typeof cube["block_states"][blockStateName] == "string") cube["block_states"][blockStateName] = this.#interpolateInBlockValues(block, cube["block_states"][blockStateName], cube);
					}
					blockOverride["states"] = { ...blockOverride["states"], ...cube["block_states"] };
					cube["block_override"] = blockOverride;
					delete cube["block_states"];
				}
				if ("if" in cube) {
					if (!this.#checkBlockStateConditional(cube["block_override"] ?? block, cube["if"], stateCandidates)) continue;
					delete cube["if"];
				}
				if ("terrain_texture" in cube) cube["terrain_texture"] = this.#interpolateInBlockValues(cube["block_override"] ?? block, cube["terrain_texture"], cube);
				if ("copy" in cube) {
					if (cube["copy"] == blockShape) continue;
					let copiedCubes = structuredClone(this.#blockShapeGeos[cube["copy"]] ?? this.#blockShapeGeos["block"] ?? []);
					let fieldsToCopy = Object.keys(cube).filter(field => !["copy", "rot", "pivot", "translate"].includes(field));
					copiedCubes.forEach(copiedCube => {
						if ("translate" in cube) copiedCube["translate"] = addVec3(copiedCube["translate"] ?? [0, 0, 0], cube["translate"]);
						fieldsToCopy.forEach(field => {
							if (field == "flip_textures_horizontally" || field == "flip_textures_vertically") {
								let faces = new Set(copiedCube[field] ?? []);
								cube[field].forEach(face => faces.has(face) ? faces.delete(face) : faces.add(face));
								copiedCube[field] = Array.from(faces);
							} else if (typeof copiedCube[field] == "object" && !Array.isArray(copiedCube[field])) {
								copiedCube[field] = { ...cube[field], ...copiedCube[field] };
							} else {
								copiedCube[field] ??= structuredClone(cube[field]);
							}
						});
						if ("rot" in cube) {
							if ("rot" in copiedCube) {
								copiedCube["extra_rots"] ??= [];
								copiedCube["extra_rots"].unshift({ "rot": cube["rot"], "pivot": cube["pivot"] ?? [8, 8, 8] });
							} else {
								copiedCube["rot"] = cube["rot"];
								copiedCube["pivot"] = cube["pivot"] ?? copiedCube["pivot"];
							}
						}
					});
					unfilteredCubes.push(...copiedCubes);
				} else if ("copy_block" in cube) {
					let match = cube["copy_block"].match(/^entity\.(.+)$/);
					let blockToCopy = match && structuredClone(block["block_entity_data"]?.[match[1]]);
					if (blockToCopy?.["name"]) {
						blockToCopy["name"] = neoNormalizeBlockName(blockToCopy["name"]);
						blockToCopy["#copied_via_copy_block"] = true;
						let newShape = this.#getBlockShape(blockToCopy["name"]);
						let newSpecial = this.#extractNeoSpecialTexture(newShape);
						let newBoxes = this.#makeNeoBoxes(blockToCopy, newSpecial?.blockShape ?? newShape, newSpecial?.texturePath, recursionGuard, cullInternalFaces, strictBlockStateErrors);
						newBoxes.forEach(newBox => {
							if ("translate" in cube) newBox["translate"] = addVec3(newBox["translate"] ?? [0, 0, 0], cube["translate"]);
							filteredCubes.push(newBox);
						});
					}
				} else {
					filteredCubes.push(cube);
				}
			}
			filteredCubes.forEach(cube => {
				if (specialTexture && !cube["neo_special_texture"]) cube["neo_special_texture"] = specialTexture;
				if (!cube["pos"] || !cube["size"]) return;
				Object.defineProperties(cube, Object.fromEntries(["x", "y", "z", "w", "h", "d"].map((prop, i) => [prop, {
					configurable: true,
					get() { return (i < 3 ? this["pos"] : this["size"])[i % 3]; },
					set(value) { (i < 3 ? this["pos"] : this["size"])[i % 3] = value; }
				}])));
			});
			let optimizable = filteredCubes.filter(cube => cube["pos"] && cube["size"]);
			let passthrough = filteredCubes.filter(cube => !cube["pos"] || !cube["size"]);
			recursionGuard.delete(blockShape);
			return cullInternalFaces ? [...passthrough, ...this.#optimizeGeometry(optimizable)] : filteredCubes;
		}

		#collectNeoRuntimeStateCandidates(cubes, visited = new Set()) {
			const candidates = new Map();
			const addCandidate = (key, value) => {
				if (!candidates.has(key)) candidates.set(key, new Set());
				candidates.get(key).add(value);
			};
			const addNestedCandidates = nestedCandidates => {
				nestedCandidates.forEach((values, key) => values.forEach(value => addCandidate(key, value)));
			};
			cubes.forEach(cube => {
				String(cube?.["if"] ?? "").replaceAll(/\s/g, "").split(/&&|\|\|/).forEach(booleanExpression => {
					const match = booleanExpression.match(/^((?:entity\.)?[\w:&-?]+)(==|!=)(-?\w+)$/);
					if (!match) return;
					let [, blockStateTerm, , expectedBlockState] = match;
					let blockStateOperation = blockStateTerm.match(/^(entity\.)?([\w:]+)(?:(\?\?|&)(-?\d+))?$/);
					if (!blockStateOperation) return;
					let [, usingBlockEntityData, blockStateName, blockStateOperator] = blockStateOperation;
					if (blockStateOperator) return;
					let key = usingBlockEntityData ? `entity.${blockStateName}` : blockStateName;
					addCandidate(key, expectedBlockState);
				});
				if (cube?.["copy"] && !visited.has(cube["copy"])) {
					visited.add(cube["copy"]);
					addNestedCandidates(this.#collectNeoRuntimeStateCandidates(this.#blockShapeGeos[cube["copy"]] ?? [], visited));
				}
			});
			return candidates;
		}

		#resolveNeoBoxTextures(block, cube, specialTexture) {
			const effectiveSpecialTexture = cube["neo_special_texture"] ?? specialTexture;
			const renderedFaceUvs = this.#getNeoRenderedFaceUvs(cube);
			if (!renderedFaceUvs) return null;
			const result = {};
			Object.keys(renderedFaceUvs).forEach(faceName => {
				let isSide = NEO_SIDE_FACE_NAMES.includes(faceName);
				let textureFace = cube["textures"]?.[faceName] ?? (isSide ? cube["textures"]?.["side"] : undefined) ?? cube["textures"]?.["*"] ?? faceName;
				if (textureFace == "none") return;
				textureFace = this.#interpolateInBlockValues(cube["block_override"] ?? block, textureFace, cube);
				const outputFaceName = this.#getNeoOutputFaceName(faceName);
				if (textureFace == "#tex" && effectiveSpecialTexture) return result[outputFaceName] = this.#neoTextureName(effectiveSpecialTexture);
				if (/^textures\/.+[^/]$/.test(textureFace)) return result[outputFaceName] = this.#neoTextureName(textureFace);
				let terrainTextureKey = cube["terrain_texture"] ?? this.#getNeoTerrainTextureKey(block["name"], textureFace, cube["variant"]);
				result[outputFaceName] = this.#neoTextureName(this.#getNeoTexturePath(terrainTextureKey, cube["variant"]));
			});
			return result;
		}

		#resolveNeoBoxUvs(block, cube) {
			const renderedFaceUvs = this.#getNeoRenderedFaceUvs(cube);
			if (!renderedFaceUvs) return null;
			const textureSize = cube["texture_size"] ?? [16, 16];
			return Object.fromEntries(Object.entries(renderedFaceUvs).filter(([faceName]) => {
				let isSide = NEO_SIDE_FACE_NAMES.includes(faceName);
				let textureFace = cube["textures"]?.[faceName] ?? (isSide ? cube["textures"]?.["side"] : undefined) ?? cube["textures"]?.["*"] ?? faceName;
				textureFace = this.#interpolateInBlockValues(cube["block_override"] ?? block, textureFace, cube);
				return textureFace != "none";
			}).map(([faceName, face]) => {
				const vertexUvs = this.#getNeoFaceVertexUvs(cube, faceName, face);
				return [this.#getNeoOutputFaceName(faceName), {
					"uv": neoClone(face["uv"]),
					"uv_size": neoClone(face["uv_size"]),
					"texture_size": neoClone(textureSize),
					"normalized_uv": face["uv"].map((x, i) => x / textureSize[i]),
					"normalized_uv_size": face["uv_size"].map((x, i) => x / textureSize[i]),
					"uv_transform": this.#getNeoFaceUvTransform(cube, faceName),
					"vertex_uvs": vertexUvs,
					"normalized_vertex_uvs": vertexUvs.map(uv => uv.map((x, i) => x / textureSize[i]))
				}];
			}));
		}

		#getNeoOutputFaceName(faceName) {
			return NEO_OUTPUT_FACE_NAMES[faceName] ?? faceName;
		}

		#getNeoFaceVertexUvs(cube, faceName, face) {
			const vertices = this.#getVertices(cube, faceName);
			const uvTransform = this.#getNeoFaceUvTransform(cube, faceName);
			let uvRot = uvTransform["rotate_quarters"] * 90;
			if (uvRot) {
				while (uvRot >= 90) {
					[vertices[0]["corner"], vertices[1]["corner"], vertices[3]["corner"], vertices[2]["corner"]] = [vertices[2]["corner"], vertices[0]["corner"], vertices[1]["corner"], vertices[3]["corner"]];
					uvRot -= 90;
				}
				while (uvRot <= -90) {
					[vertices[2]["corner"], vertices[0]["corner"], vertices[1]["corner"], vertices[3]["corner"]] = [vertices[0]["corner"], vertices[1]["corner"], vertices[3]["corner"], vertices[2]["corner"]];
					uvRot += 90;
				}
			}
			if (uvTransform["flip_u"]) {
				[vertices[0]["corner"], vertices[1]["corner"]] = [vertices[1]["corner"], vertices[0]["corner"]];
				[vertices[2]["corner"], vertices[3]["corner"]] = [vertices[3]["corner"], vertices[2]["corner"]];
			}
			if (uvTransform["flip_v"]) {
				[vertices[0]["corner"], vertices[2]["corner"]] = [vertices[2]["corner"], vertices[0]["corner"]];
				[vertices[1]["corner"], vertices[3]["corner"]] = [vertices[3]["corner"], vertices[1]["corner"]];
			}
			return vertices.map(vertex => [
				face["uv"][0] + face["uv_size"][0] * (vertex["corner"] & 1),
				face["uv"][1] + face["uv_size"][1] * (vertex["corner"] >> 1)
			]);
		}

		#getNeoFaceUvTransform(cube, faceName) {
			const isSideFace = NEO_SIDE_FACE_NAMES.includes(faceName);
			const rawUvRot = cube["uv_rot"]?.[faceName] ?? (isSideFace ? cube["uv_rot"]?.["side"] : undefined) ?? cube["uv_rot"]?.["*"] ?? 0;
			const uvRotNumber = Number(rawUvRot);
			const normalizedRotation = Number.isFinite(uvRotNumber) ? ((Math.trunc(uvRotNumber / 90) % 4) + 4) % 4 : 0;
			let flipU = Boolean(cube["flip_textures_horizontally"]?.includes(faceName)) ^ Boolean(isSideFace && cube["flip_textures_horizontally"]?.includes("side")) ^ Boolean(cube["flip_textures_horizontally"]?.includes("*"));
			let flipV = Boolean(cube["flip_textures_vertically"]?.includes(faceName)) ^ Boolean(isSideFace && cube["flip_textures_vertically"]?.includes("side")) ^ Boolean(cube["flip_textures_vertically"]?.includes("*"));
			if ("box_uv" in cube) {
				flipU = Boolean(flipU ^ (faceName != "north" && faceName != "south"));
				flipV = Boolean(flipV ^ (faceName == "up"));
			}
			// flipU = Boolean(flipU ^ (faceName == "down" || faceName == "up"));
			// flipV = Boolean(flipV ^ (faceName == "down" || faceName == "up"));
			return {
				"rotate_quarters": normalizedRotation,
				"flip_u": flipU,
				"flip_v": flipV
			};
		}

		#getNeoRenderedFaceUvs(cube) {
			if (!cube["pos"] || !cube["size"]) return null;
			let uv = this.#calculateUv(cube);
			if (cube.w == 0) [/*"east",*/ "down", "up", "north", "south"].forEach(faceName => delete uv[faceName]);
			if (cube.h == 0) ["west", "east", /*"up"*/, "north", "south"].forEach(faceName => delete uv[faceName]);
			if (cube.d == 0) ["west", "east", "down", "up", /*"south"*/].forEach(faceName => delete uv[faceName]);
			return uv;
		}

		#neoTextureName(texturePath) {
			if (!texturePath) return "";
			return String(texturePath).replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.(png|tga)$/i, "");
		}

		#getNeoBlockEntry(blockName) {
			if (!this.blocksJson) return null;
			let candidates = [blockName, neoNormalizeBlockName(blockName), `minecraft:${neoNormalizeBlockName(blockName)}`];
			for (let candidate of candidates) if (candidate in this.blocksJson) return this.blocksJson[candidate];
			return null;
		}

		#getNeoTerrainTextureKey(blockName, textureFace, variant) {
			let normalized = neoNormalizeBlockName(blockName);
			let patch = !this.#getNeoBlockEntry(normalized) && NEO_BLOCKS_DOT_JSON_PATCHES[normalized];
			if (patch) normalized = patch.split(".")[0];
			let blockEntry = this.#getNeoBlockEntry(normalized);
			if (!blockEntry) return "";
			let textureKeys;
			if (String(textureFace).startsWith("carried") && blockEntry["carried_textures"]) {
				if (textureFace == "carried" && typeof blockEntry["carried_textures"] == "string") return blockEntry["carried_textures"];
				let carriedFace = String(textureFace).slice(8);
				return blockEntry["carried_textures"][carriedFace] ?? (NEO_SIDE_FACE_NAMES.includes(carriedFace) ? blockEntry["carried_textures"]["side"] : undefined) ?? "";
			}
			if (NEO_BLOCKS_TO_USE_CARRIED_TEXTURES.includes(normalized)) textureKeys = blockEntry["carried_textures"];
			textureKeys ??= blockEntry["textures"];
			if (!textureKeys) return "";
			if (typeof textureKeys == "string") return textureKeys;
			return textureKeys[textureFace] ?? (NEO_SIDE_FACE_NAMES.includes(textureFace) ? textureKeys["side"] : undefined) ?? textureKeys[Object.keys(textureKeys)[0]] ?? "";
		}

		#getNeoTexturePath(terrainTextureKey, variant) {
			let texturePath = this.terrainTextureJson?.["texture_data"]?.[terrainTextureKey] ?? this.terrainTextureJson?.[terrainTextureKey];
			if (texturePath && typeof texturePath == "object" && "textures" in texturePath) texturePath = texturePath["textures"];
			if (Array.isArray(texturePath)) {
				let i = variant == -1 ? 0 : variant;
				texturePath = texturePath[i] ?? texturePath[0];
			}
			return typeof texturePath == "string" ? texturePath : texturePath?.["path"];
		}

		#addNeoDescriptorRequirement(template, kind, key, source, candidates = []) {
			if (!key || key.startsWith("#")) return;
			let bucket = kind == "entity" ? template["block_entity_data"] : template["states"];
			bucket[key] ??= { "value": null, "candidates": [], "sources": [] };
			if (!bucket[key]["sources"].includes(source)) bucket[key]["sources"].push(source);
			candidates.map(String).forEach(candidate => { if (!bucket[key]["candidates"].includes(candidate)) bucket[key]["candidates"].push(candidate); });
			neoSortDescriptorCandidates(bucket[key]["candidates"]);
		}

		#collectNeoShapeRequirements(template, blockShape, visited) {
			if (visited.has(blockShape)) return;
			visited.add(blockShape);
			(this.#blockShapeGeos[blockShape] ?? []).forEach(cube => {
				if (cube["if"]) this.#collectNeoExpressionRequirements(template, cube["if"], "geometry.if");
				if (cube["copy"]) this.#collectNeoShapeRequirements(template, cube["copy"], visited);
				if (cube["copy_block"]) this.#collectNeoCopyBlockRequirements(template, cube["copy_block"], "geometry.copy_block");
				[cube["terrain_texture"], cube["tint"], ...Object.values(cube["textures"] ?? {}), ...Object.values(cube["block_states"] ?? {})].forEach(expr => typeof expr == "string" && this.#collectNeoInterpolationRequirements(template, expr, "geometry.interpolation", cube));
			});
		}

		#collectNeoStateDefinitionRequirements(template, blockName, blockShape) {
			[this.#blockShapeBlockStateRotations.get(blockShape), this.#blockNameBlockStateRotations.get(blockName), this.#blockShapeBlockStateTextureVariants.get(blockShape), this.#blockNameBlockStateTextureVariants.get(blockName), this.#blockNamePatternBlockStateTextureVariants.find(([pattern]) => pattern.test(blockName))?.[1]].filter(Boolean).forEach(defs => {
				Object.entries(defs).forEach(([stateName, values]) => {
					if (stateName == "#exclusive_add") return;
					this.#addNeoDescriptorRequirement(template, stateName.startsWith("entity.") ? "entity" : "state", stateName.replace(/^entity\./, ""), "blockStateDefinitions", Object.keys(values));
				});
			});
			[this.#globalBlockStateRotations, this.#globalBlockStateTextureVariants].filter(Boolean).forEach(defs => {
				Object.entries(defs).forEach(([stateName, values]) => {
					if (stateName == "#exclusive_add") return;
					const kind = stateName.startsWith("entity.") ? "entity" : "state";
					const key = stateName.replace(/^entity\./, "");
					const bucket = kind == "entity" ? template["block_entity_data"] : template["states"];
					if (bucket[key]) this.#addNeoDescriptorRequirement(template, kind, key, "blockStateDefinitions", Object.keys(values));
				});
			});
			this.#getNeoGlobalStateDefinitionHints(blockName).forEach(stateName => {
				this.#addNeoGlobalStateDefinitionRequirement(template, stateName);
			});
		}

		#getNeoGlobalStateDefinitionHints(blockName) {
			const hints = new Set(NEO_GLOBAL_STATE_DEFINITION_HINTS[blockName] ?? []);
			NEO_GLOBAL_STATE_DEFINITION_HINT_PATTERNS.forEach(([pattern, stateNames]) => {
				if (pattern.test(blockName)) stateNames.forEach(stateName => hints.add(stateName));
			});
			return Array.from(hints);
		}

		#addNeoGlobalStateDefinitionRequirement(template, stateName) {
			const kind = stateName.startsWith("entity.") ? "entity" : "state";
			const key = stateName.replace(/^entity\./, "");
			[this.#globalBlockStateRotations?.[stateName], this.#globalBlockStateTextureVariants?.[stateName]].filter(Boolean).forEach(values => {
				this.#addNeoDescriptorRequirement(template, kind, key, "blockStateDefinitions", Object.keys(values));
			});
		}

		#collectNeoExpressionRequirements(template, expression, source) {
			String(expression).replaceAll(/\s/g, "").split(/&&|\|\|/).forEach(part => {
				let match = part.match(/^((?:entity\.)?[\w:&-?]+)(==|>|<|>=|<=|!=)(-?\w+)$/);
				let term = match?.[1].match(/^(entity\.)?([\w:]+)(?:(\?\?|&)(-?\d+))?$/);
				if (term) this.#addNeoDescriptorRequirement(template, term[1] ? "entity" : "state", term[2], source, [match[3]]);
			});
		}

		#collectNeoInterpolationRequirements(template, expression, source, cube = null) {
			String(expression).replaceAll(/\$\{([^}]+)\}/g, (_whole, inner) => {
				let expr = inner.replaceAll(/\s/g, "");
				let state = expr.match(/^#block_states\.(\w+)/)?.[1];
				let entity = expr.match(/^#block_entity_data\.(\w+)/)?.[1];
				let arrayMatch = expr.match(/^Array\.(\w+)\[([^\[]+)\]$/);
				let array = arrayMatch?.[2];
				let arrayCandidates = Object.keys(cube?.["arrays"]?.[arrayMatch?.[1]] ?? {});
				if (state) this.#addNeoDescriptorRequirement(template, "state", state, source);
				if (entity) this.#addNeoDescriptorRequirement(template, "entity", entity, source);
				if (array) this.#addNeoDescriptorRequirement(template, array.startsWith("entity.") ? "entity" : "state", array.replace(/^entity\./, ""), source, arrayCandidates);
			});
		}

		#collectNeoCopyBlockRequirements(template, expression, source) {
			let entity = String(expression).match(/^entity\.(\w+)$/)?.[1];
			if (entity) this.#addNeoDescriptorRequirement(template, "entity", entity, source);
			this.#collectNeoInterpolationRequirements(template, expression, source);
		}

		/**
		 * Resolves UVs in template faces.
		 * @param {PolyMeshTemplateFace[]} faces
		 * @param {TextureAtlas} textureAtlas
		 * @returns {PolyMeshTemplateFaceWithUvs[]}
		 */
		static resolveTemplateFaceUvs(faces, textureAtlas) {
			return faces.map(face => {
				let imageUv = textureAtlas.uvs[face["textureRefI"]];
				face["vertices"].sort((a, b) => a["corner"] - b["corner"]);
				if ("crop" in imageUv) {
					this.#applyFaceCropping(face, imageUv["crop"]);
				}
				let vertices = tuple([face["vertices"][0], face["vertices"][1], face["vertices"][3], face["vertices"][2]]); // go around in a square
				return {
					"normal": face["normal"],
					"transparency": imageUv["transparency"],
					"vertices": vertices.map(vertex => ({
						"pos": vertex["pos"],
						"uv": tuple([+((imageUv["uv"][0] + imageUv["uv_size"][0] * (vertex["corner"] & 1)) / textureAtlas.textureWidth).toFixed(4), +(1 - (imageUv["uv"][1] + imageUv["uv_size"][1] * (vertex["corner"] >> 1)) / textureAtlas.textureHeight).toFixed(4)])
					}))
				};
			});
		}
		/**
		 * Crops a face, modifying the input object.
		 * @param {PolyMeshTemplateFace} face
		 * @param {Rectangle} crop
		 */
		static #applyFaceCropping(face, crop) {
			let v0 = face["vertices"][0];
			let v1 = face["vertices"][1];
			let v2 = face["vertices"][2];
			let v3 = face["vertices"][3];
			let v0pos = v0["pos"];
			let v1pos = v1["pos"];
			let v2pos = v2["pos"];
			let v3pos = v3["pos"];
			let textureXDir = subVec3(v1pos, v0pos);
			let textureYDir = subVec3(v2pos, v0pos);
			let cropXRem = 1 - crop["w"] - crop["x"]; // remaining horizontal space on the other side of the cropped region
			let cropYRem = 1 - crop["h"] - crop["y"];
			v0["pos"] = addVec3(v0pos, [textureXDir[0] * crop["x"] + textureYDir[0] * crop["y"], textureXDir[1] * crop["x"] + textureYDir[1] * crop["y"], textureXDir[2] * crop["x"] + textureYDir[2] * crop["y"]]);
			v1["pos"] = addVec3(v1pos, [-textureXDir[0] * cropXRem + textureYDir[0] * crop["y"], -textureXDir[1] * cropXRem + textureYDir[1] * crop["y"], -textureXDir[2] * cropXRem + textureYDir[2] * crop["y"]]);
			v2["pos"] = addVec3(v2pos, [textureXDir[0] * crop["x"] - textureYDir[0] * cropYRem, textureXDir[1] * crop["x"] - textureYDir[1] * cropYRem, textureXDir[2] * crop["x"] - textureYDir[2] * cropYRem]);
			v3["pos"] = addVec3(v3pos, [-textureXDir[0] * cropXRem - textureYDir[0] * cropYRem, -textureXDir[1] * cropXRem - textureYDir[1] * cropYRem, -textureXDir[2] * cropXRem - textureYDir[2] * cropYRem]);
		}
	}

	window.neoHoloprintDB_NeoBlockGeoMaker = NeoBlockGeoMaker;
})();

/** @import { Vec3, Block, HoloPrintConfig, PolyMeshTemplateFaceWithUvs, PolyMeshTemplateFace, Rectangle, PolyMeshTemplateVertex, CubeUv } from "./HoloPrint.js"  */
/** @import TextureAtlas from "./TextureAtlas.js" */
/** @import * as Data from "./data/schemas" */
