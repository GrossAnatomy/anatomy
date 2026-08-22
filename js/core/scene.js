// js/core/scene.js - Three.js scene setup and intersection helpers

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { state, dom } from '../state.js';
import { showStatus, toDisplayCoords } from '../utils/helpers.js';


// ============ Scene Initialization ============

/**
 * Calculates the available viewport width, accounting for sidebar state.
 * On tablet (coarse pointer), sidebar can be collapsed.
 * On desktop, sidebar is always visible at 320px.
 */
export function getViewportWidth() {
    const sidebar = document.getElementById('sidebar');
    const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
    
    // On tablet with collapsed sidebar, use full width
    if (
        isCoarsePointer &&
        sidebar &&
        sidebar.classList.contains('collapsed')
    ) {
        return window.innerWidth;
    }
    
    // Otherwise subtract sidebar width
    const sidebarWidth = isCoarsePointer ? 280 : 320;

    return window.innerWidth - sidebarWidth;
}


/**
 * Calculates the available viewport height,
 * accounting for header and toolbar.
 */
export function getViewportHeight() {

    // Header (50px) + toolbar (38px) = 88px
    return window.innerHeight - 88;
}


export function initScene() {

    state.scene = new THREE.Scene();

    state.scene.background =
        new THREE.Color(0x041D31);


    const width =
        getViewportWidth();

    const height =
        getViewportHeight();


    // alpha: true is required for transparent exports
    state.renderer =
        new THREE.WebGLRenderer({
            canvas: dom.canvas,
            antialias: true,
            preserveDrawingBuffer: true,
            alpha: true
        });


    state.renderer.setSize(
        width,
        height
    );


    state.renderer.setPixelRatio(
        window.devicePixelRatio
    );


    state.renderer.outputColorSpace =
        THREE.SRGBColorSpace;


    // Annotation objects group
    state.scene.add(
        state.annotationObjects
    );


    // WebGL context loss detection
    dom.canvas.addEventListener(
        'webglcontextlost',

        (event) => {

            event.preventDefault();

            console.error(
                '⚠️ WebGL context LOST! The GPU ran out of resources.'
            );

            console.error(
                'This typically happens when a model is too large for the GPU to handle.'
            );

            state.webglContextLost =
                true;


            showStatus(
                'WebGL context lost — model too large for GPU. Try a smaller model.',
                10
            );


            // Hide loading screen if it's still showing
            dom.loading.classList.remove(
                'visible'
            );

        },

        false
    );


    dom.canvas.addEventListener(
        'webglcontextrestored',

        () => {

            console.log(
                'WebGL context restored.'
            );

            state.webglContextLost =
                false;

            showStatus(
                'WebGL context restored. Please reload your model.'
            );
        },

        false
    );
}


// ============ Controls ============

export function initControls() {

    state.controls =
        new OrbitControls(
            state.camera,
            state.renderer.domElement
        );

    state.controls.enableDamping =
        true;

    state.controls.dampingFactor =
        0.05;
}


// ============ Grid ============

export function addGrid() {

    const gridHelper =
        new THREE.GridHelper(
            10,
            10,
            0x1A5A8A,
            0x1A5A8A
        );

    gridHelper.name =
        'gridHelper';

    state.scene.add(
        gridHelper
    );
}


// ============ Window Resize ============

export function onWindowResize() {

    const width =
        getViewportWidth();

    const height =
        getViewportHeight();

    const aspect =
        width / height;


    // Update perspective camera
    state.perspectiveCamera.aspect =
        aspect;

    state.perspectiveCamera
        .updateProjectionMatrix();


    // Update orthographic camera
    const frustumSize =
        state.orthographicCamera.top * 2;


    state.orthographicCamera.left =
        -frustumSize * aspect / 2;


    state.orthographicCamera.right =
        frustumSize * aspect / 2;


    state.orthographicCamera
        .updateProjectionMatrix();


    state.renderer.setSize(
        width,
        height
    );


    // Update line material resolutions
    state.annotationObjects.traverse(
        (child) => {

            if (
                child.material &&
                child.material.isLineMaterial
            ) {

                child.material.resolution.set(
                    width,
                    height
                );
            }
        }
    );
}


// ============ Model Flip ============

/**
 * Toggles the model flip state.
 * Rotates the model 180° around the X axis.
 *
 * Stored annotation coordinates remain unchanged.
 */
export function toggleFlip() {

    if (!state.currentModel) {
        return;
    }
    

    state.isFlipped =
        !state.isFlipped;
    

    // Rotate model by π around X axis
    if (state.isFlipped) {

        state.currentModel.rotation.x +=
            Math.PI;

    } else {

        state.currentModel.rotation.x -=
            Math.PI;
    }
    

    // Re-center model after rotation change
    state.currentModel.updateMatrixWorld(
        true
    );


    const box =
        new THREE.Box3()
            .setFromObject(
                state.currentModel
            );


    const center =
        box.getCenter(
            new THREE.Vector3()
        );


    state.currentModel.position.sub(
        center
    );
    

    // Update button visual
    dom.flipToggle.classList.toggle(
        'active',
        state.isFlipped
    );
    

    showStatus(
        state.isFlipped
            ? 'Model flipped (visual only)'
            : 'Model un-flipped'
    );
}


// ============ Raycasting ============

export function getIntersection(event) {

    if (!state.currentModel) {
        return null;
    }


    const rect =
        dom.canvas.getBoundingClientRect();


    const mouse =
        new THREE.Vector2(

            (
                (event.clientX - rect.left) /
                rect.width
            ) * 2 - 1,

            -(
                (event.clientY - rect.top) /
                rect.height
            ) * 2 + 1
        );


    const raycaster =
        new THREE.Raycaster();


    raycaster.setFromCamera(
        mouse,
        state.camera
    );


    const intersects =
        raycaster.intersectObject(
            state.currentModel,
            true
        );


    return intersects.length > 0
        ? intersects[0].point.clone()
        : null;
}


export function getIntersectionFull(event) {

    if (!state.currentModel) {
        return null;
    }


    const rect =
        dom.canvas.getBoundingClientRect();


    const mouse =
        new THREE.Vector2(

            (
                (event.clientX - rect.left) /
                rect.width
            ) * 2 - 1,

            -(
                (event.clientY - rect.top) /
                rect.height
            ) * 2 + 1
        );


    const raycaster =
        new THREE.Raycaster();


    raycaster.setFromCamera(
        mouse,
        state.camera
    );


    const intersects =
        raycaster.intersectObjects(
            state.modelMeshes,
            false
        );


    if (intersects.length > 0) {

        return {

            point:
                intersects[0].point.clone(),

            faceIndex:
                intersects[0].faceIndex,

            mesh:
                intersects[0].object
        };
    }


    return null;
}


// ============================================================
// Text Sprite Helpers
// ============================================================

/**
 * Creates text as a Three.js Sprite.
 *
 * fontSize controls texture resolution.
 *
 * The actual 3D size of the label is controlled by
 * updateAnnotationLabelScales().
 */
export function createTextSprite(
    text,
    color = '#EDC040',
    backgroundColor = null,
    fontSize = 96
) {

    const canvas =
        document.createElement(
            'canvas'
        );


    const context =
        canvas.getContext(
            '2d'
        );


    // --------------------------------------------------------
    // Measure text
    // --------------------------------------------------------

    context.font =
        `bold ${fontSize}px Arial`;


    const metrics =
        context.measureText(
            text
        );


    const textWidth =
        Math.ceil(
            metrics.width
        );


    const textHeight =
        fontSize;


    // Extra space around text
    const padding =
        16;


    canvas.width =
        textWidth +
        padding * 2;


    canvas.height =
        textHeight +
        padding * 2;


    /*
     * IMPORTANT:
     * changing canvas width/height resets context settings,
     * therefore font must be set again.
     */
    context.font =
        `bold ${fontSize}px Arial`;


    context.textAlign =
        'center';


    context.textBaseline =
        'middle';


    // --------------------------------------------------------
    // Dark outline
    // --------------------------------------------------------

    context.strokeStyle =
        'rgba(0, 0, 0, 0.9)';


    context.lineWidth =
        6;


    context.strokeText(
        text,
        canvas.width / 2,
        canvas.height / 2
    );


    // --------------------------------------------------------
    // Main text
    // --------------------------------------------------------

    context.fillStyle =
        color;


    context.fillText(
        text,
        canvas.width / 2,
        canvas.height / 2
    );


    // --------------------------------------------------------
    // Create texture
    // --------------------------------------------------------

    const texture =
        new THREE.CanvasTexture(
            canvas
        );


    texture.needsUpdate =
        true;


    texture.colorSpace =
        THREE.SRGBColorSpace;


    // --------------------------------------------------------
    // Sprite material
    // --------------------------------------------------------

    const spriteMaterial =
        new THREE.SpriteMaterial({

            map: texture,

            transparent: true,

            depthTest: false,

            depthWrite: false
        });


    const sprite =
        new THREE.Sprite(
            spriteMaterial
        );


    // Always show label above model surface
    sprite.renderOrder =
        9999;


    // --------------------------------------------------------
    // Store label information
    // --------------------------------------------------------

    const aspect =
        canvas.width /
        canvas.height;


    /*
     * These values are used later by
     * updateAnnotationLabelScales().
     */
    sprite.userData.textAspect =
        aspect;


    sprite.userData.isAnnotationLabel =
        true;


    /*
     * Temporary initial scale.
     * This scale will be recalculated
     * every frame.
     */
    sprite.scale.set(
        aspect,
        1,
        1
    );


    return sprite;
}


// ============================================================
// Scaled Text Sprite
// ============================================================

export function createScaledTextSprite(
    text,
    color,
    position,
    scaleFactor = 1
) {

    const sprite =
        createTextSprite(
            text,
            color,
            null,
            96
        );


    sprite.position.copy(
        position
    );


    /*
     * Store caller-specific scale.
     *
     * render.js currently normally passes
     * values such as 0.8 or 1.
     */
    sprite.userData.annotationScaleFactor =
        scaleFactor;


    return sprite;
}


// ============================================================
// Annotation Label Scale Compensation
// ============================================================

/**
 * Keeps annotation text readable when
 * the model is zoomed in or out.
 *
 * main.js must call this function once
 * per animation frame before:
 *
 * state.renderer.render(...)
 */
export function updateAnnotationLabelScales() {

    if (
        !state.camera ||
        !state.annotationObjects
    ) {

        return;
    }


    state.annotationObjects.traverse(
        (obj) => {

            /*
             * Only modify our annotation text sprites.
             */
            if (
                !obj.isSprite ||
                !obj.userData.isAnnotationLabel
            ) {

                return;
            }


            // Text width : height ratio
            const aspect =
                obj.userData.textAspect ||
                1;


            // Per-label multiplier
            const annotationScaleFactor =
                obj.userData.annotationScaleFactor ||
                1;


            // ------------------------------------------------
            // Camera distance
            // ------------------------------------------------

            const distance =
                state.camera.position.distanceTo(
                    obj.position
                );


            /*
             * =================================================
             * LABEL SIZE
             * =================================================
             *
             * This is the MAIN number to change
             * if the label is too small or too large.
             *
             * 0.05 = small
             * 0.10 = medium
             * 0.20 = large
             * 0.30 = very large
             * 0.50 = extremely large
             *
             * We intentionally start large because
             * the current anatomical model labels
             * have been much too small.
             */
            const TEXT_SCREEN_SCALE =
                0.04;


            /*
             * MeshNotes existing Text Size slider.
             */
            const textSizeMultiplier =
                state.textSizeMultiplier ||
                1;


            /*
             * Camera-distance compensation.
             *
             * If camera distance becomes 2x,
             * world-space text height becomes 2x.
             *
             * Therefore the apparent screen size
             * remains approximately stable.
             */
            const height =
                distance *
                TEXT_SCREEN_SCALE *
                annotationScaleFactor *
                textSizeMultiplier;


            // ------------------------------------------------
            // Apply label size
            // ------------------------------------------------

            obj.scale.set(
                aspect * height,
                height,
                1
            );
        }
    );
}