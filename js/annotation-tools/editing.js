// js/annotation-tools/editing.js

import * as THREE from 'three';

import { state, dom } from '../state.js';

import {
    showStatus,
    toStorageCoords
} from '../utils/helpers.js';

import {
    getIntersection
} from '../core/scene.js';

import {
    computeProjectedEdgesFlipAware,
    recomputeAdjacentEdgesFlipAware
} from './projection.js';

import {
    renderAnnotations
} from './render.js';

import {
    updateGroupsList
} from './groups.js';

import {
    handleMeasureTap,
    clearActiveMeasurement
} from './measure.js';

import {
    getIntersectionWithFace,
    paintAtPoint,
    finishSurfacePainting,
    clearTempSurface,
    _startPaintLoop,
    _stopPaintLoop,
    queuePaintInput,
    setSurfacePaintCallbacks,
    handleSurfaceTap,
    handleSurfaceDoubleTap
} from './surface-paint.js';

import {
    setDrawingCallbacks,
    addDrawingPoint,
    handlePointTap,
    finishDrawing
} from './drawing.js';

import {
    clearPendingBox,
    updatePendingBoxManipulation,
    updateSelectedBoxManipulation,
    confirmBoxPlacement,
    endPendingBoxManipulation,
    endSelectedBoxManipulation,
    setBoxEditCallbacks,
    handleUnlockedBoxClickElsewhere,
    beginBoxPlacement,
    toggleExistingBoxLock,
    handlePendingBoxPointerDown,
    beginBoxHandleDrag,
    beginBoxBodyDrag
} from './box-edit.js';


// ============================================================
// Editing callbacks
// ============================================================

export function setEditingCallbacks({
    openAnnotationPopup,
    setTool
}) {

    setSurfacePaintCallbacks({
        openAnnotationPopup,
        setTool
    });

    setBoxEditCallbacks({
        openAnnotationPopup,
        setTool
    });

    setDrawingCallbacks({
        openAnnotationPopup,
        setTool
    });
}


// ============================================================
// POINT:
// Get clicked position + surface normal
// ============================================================

/**
 * Returns:
 *
 * {
 *     point: THREE.Vector3,
 *     normal: THREE.Vector3
 * }
 *
 * The normal is calculated from the exact triangle that
 * was clicked and transformed into world/display coordinates.
 *
 * The normal is then oriented toward the camera so that
 * inconsistent triangle winding in imported anatomical
 * meshes does not make some leader lines point inward.
 */
function getPointHitWithNormal(event) {

    const hit =
        getIntersectionWithFace(
            event
        );


    if (
        !hit ||
        !hit.mesh ||
        hit.faceIndex == null
    ) {

        return null;
    }


    const mesh =
        hit.mesh;


    const geometry =
        mesh.geometry;


    if (
        !geometry
    ) {

        return null;
    }


    const position =
        geometry.attributes.position;


    if (
        !position
    ) {

        return null;
    }


    const faceIndex =
        hit.faceIndex;


    let a;
    let b;
    let c;


    // --------------------------------------------------------
    // Get triangle vertex indices
    // --------------------------------------------------------

    if (
        geometry.index
    ) {

        a =
            geometry.index.getX(
                faceIndex * 3
            );

        b =
            geometry.index.getX(
                faceIndex * 3 + 1
            );

        c =
            geometry.index.getX(
                faceIndex * 3 + 2
            );

    } else {

        a =
            faceIndex * 3;

        b =
            faceIndex * 3 + 1;

        c =
            faceIndex * 3 + 2;
    }


    // --------------------------------------------------------
    // Triangle vertices in mesh-local coordinates
    // --------------------------------------------------------

    const va =
        new THREE.Vector3()
            .fromBufferAttribute(
                position,
                a
            );


    const vb =
        new THREE.Vector3()
            .fromBufferAttribute(
                position,
                b
            );


    const vc =
        new THREE.Vector3()
            .fromBufferAttribute(
                position,
                c
            );


    // --------------------------------------------------------
    // Calculate local triangle normal
    // --------------------------------------------------------

    const edge1 =
        new THREE.Vector3()
            .subVectors(
                vb,
                va
            );


    const edge2 =
        new THREE.Vector3()
            .subVectors(
                vc,
                va
            );


    const normal =
        new THREE.Vector3()
            .crossVectors(
                edge1,
                edge2
            );


    if (
        normal.lengthSq() <
        1e-12
    ) {

        return null;
    }


    normal.normalize();


    // --------------------------------------------------------
    // Local normal -> world/display normal
    // --------------------------------------------------------

    const normalMatrix =
        new THREE.Matrix3()
            .getNormalMatrix(
                mesh.matrixWorld
            );


    normal
        .applyMatrix3(
            normalMatrix
        )
        .normalize();


    // --------------------------------------------------------
    // Ensure normal points toward visible side
    // --------------------------------------------------------

    if (
        state.camera
    ) {

        const toCamera =
            new THREE.Vector3()
                .subVectors(
                    state.camera.position,
                    hit.point
                );


        if (
            toCamera.lengthSq() >
            1e-12
        ) {

            toCamera.normalize();


            if (
                normal.dot(
                    toCamera
                ) < 0
            ) {

                normal.negate();
            }
        }
    }


    return {

        point:
            hit.point.clone(),

        normal:
            normal.clone()
    };
}


// ============================================================
// Helper:
// calculate world surface normal from Raycaster intersection
// ============================================================

function getNormalFromIntersection(
    intersection
) {

    if (
        !intersection ||
        !intersection.object ||
        !intersection.face
    ) {

        return null;
    }


    const mesh =
        intersection.object;


    const normal =
        intersection.face.normal.clone();


    const normalMatrix =
        new THREE.Matrix3()
            .getNormalMatrix(
                mesh.matrixWorld
            );


    normal
        .applyMatrix3(
            normalMatrix
        )
        .normalize();


    // --------------------------------------------------------
    // Force the normal toward the visible side
    // --------------------------------------------------------

    if (
        state.camera &&
        intersection.point
    ) {

        const toCamera =
            new THREE.Vector3()
                .subVectors(
                    state.camera.position,
                    intersection.point
                );


        if (
            toCamera.lengthSq() >
            1e-12
        ) {

            toCamera.normalize();


            if (
                normal.dot(
                    toCamera
                ) < 0
            ) {

                normal.negate();
            }
        }
    }


    return normal;
}


// ============================================================
// Cancel unfinished drawing
// ============================================================

/**
 * Cancel an in-progress point/line/polygon drawing,
 * surface paint, or box placement.
 *
 * Measurements are deliberately NOT cleared.
 */
export function cancelUnfinishedDrawing() {

    state.tempPoints =
        [];


    state.tempProjectedEdges =
        [];


    if (
        state.tempLine
    ) {

        if (
            state.tempLine.geometry
        ) {

            state.tempLine.geometry.dispose();
        }


        if (
            state.tempLine.material
        ) {

            state.tempLine.material.dispose();
        }


        state.annotationObjects.remove(
            state.tempLine
        );


        state.tempLine =
            null;
    }


    // Clear temporary point data
    state.pendingPointPosition =
        null;


    state.pendingPointNormal =
        null;


    clearTempSurface();

    clearPendingBox();
}


// ============================================================
// Clear temporary drawing
// ============================================================

export function clearTempDrawing() {

    cancelUnfinishedDrawing();

    clearActiveMeasurement();
}


// ============================================================
// Canvas Tap
// ============================================================

export function onCanvasTap(event) {

    if (
        state.wasDragging
    ) {

        state.wasDragging =
            false;

        return;
    }


    if (
        handleUnlockedBoxClickElsewhere(
            event
        )
    ) {

        return;
    }


    if (
        !state.currentTool ||
        !state.currentModel
    ) {

        return;
    }


    // ========================================================
    // POINT TOOL
    // ========================================================

    if (
        state.currentTool === 'point'
    ) {

        /*
         * Calculate the clicked triangle's exact
         * surface normal.
         */
        const hit =
            getPointHitWithNormal(
                event
            );


        if (
            !hit
        ) {

            return;
        }


        handlePointTap(
            event,
            hit.point,
            hit.normal
        );


        return;
    }


    // ========================================================
    // OTHER TOOLS
    // ========================================================

    const point =
        getIntersection(
            event
        );


    if (
        !point
    ) {

        return;
    }


    // --------------------------------------------------------
    // Line / polygon
    // --------------------------------------------------------

    if (
        state.currentTool === 'line' ||
        state.currentTool === 'polygon'
    ) {

        addDrawingPoint(
            point
        );
    }


    // --------------------------------------------------------
    // Measure
    // --------------------------------------------------------

    else if (
        state.currentTool === 'measure'
    ) {

        handleMeasureTap(
            event,
            point
        );
    }


    // --------------------------------------------------------
    // Surface
    // --------------------------------------------------------

    else if (
        state.currentTool === 'surface'
    ) {

        handleSurfaceTap(
            event
        );
    }


    // --------------------------------------------------------
    // Box
    // --------------------------------------------------------

    else if (
        state.currentTool === 'box'
    ) {

        beginBoxPlacement(
            event,
            point
        );
    }
}


// ============================================================
// Canvas Double Tap
// ============================================================

export function onCanvasDoubleTap(event) {

    if (
        !state.currentModel
    ) {

        return;
    }


    if (
        state.currentTool === 'line' &&
        state.tempPoints.length >= 2
    ) {

        finishDrawing(
            event,
            'line'
        );

    } else if (
        state.currentTool === 'polygon' &&
        state.tempPoints.length >= 3
    ) {

        finishDrawing(
            event,
            'polygon'
        );

    } else if (
        state.currentTool === 'surface' &&
        state.paintedFaces.size > 0
    ) {

        handleSurfaceDoubleTap(
            event
        );

    } else if (
        state.isBoxPlacementMode &&
        state.pendingBoxData
    ) {

        confirmBoxPlacement(
            event
        );

    } else if (
        !state.currentTool
    ) {

        toggleExistingBoxLock(
            event
        );
    }
}


// ============================================================
// Canvas Pointer Down
// ============================================================

export function onCanvasPointerDown(event) {

    // ========================================================
    // POINT TOOL
    // ========================================================

    if (
        state.currentTool === 'point' &&
        state.currentModel &&
        event.button === 0
    ) {

        const hit =
            getPointHitWithNormal(
                event
            );


        if (
            hit
        ) {

            /*
             * Keep point and normal from pointer-down.
             *
             * handlePointTap() will use these when the
             * corresponding tap/click event arrives.
             */
            state.pendingPointPosition =
                hit.point.clone();


            state.pendingPointNormal =
                hit.normal.clone();

        } else {

            state.pendingPointPosition =
                null;


            state.pendingPointNormal =
                null;
        }


        return;
    }


    // ========================================================
    // SURFACE TOOL
    // ========================================================

    if (
        state.currentTool === 'surface' &&
        state.currentModel &&
        event.button === 0
    ) {

        state.isPaintingSurface =
            true;


        state.controls.enabled =
            false;


        // Start tracking a new stroke for undo
        state.currentStrokeAdded =
            new Set();


        state.currentStrokeRemoved =
            new Set();


        queuePaintInput(
            event.clientX,
            event.clientY,
            event.shiftKey
        );


        _startPaintLoop();


        return;
    }


    // ========================================================
    // BOX PLACEMENT
    // ========================================================

    if (
        handlePendingBoxPointerDown(
            event
        )
    ) {

        return;
    }


    /*
     * Marker dragging only works when
     * no annotation tool is currently active.
     */
    if (
        !state.currentModel ||
        state.currentTool
    ) {

        return;
    }


    const rect =
        dom.canvas
            .getBoundingClientRect();


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


    // ========================================================
    // Check annotation markers
    // ========================================================

    const markerObjects =
        state.annotationObjects.children.filter(

            obj =>
                obj.userData.isAnnotationMarker &&
                obj.isMesh
        );


    const intersects =
        raycaster.intersectObjects(
            markerObjects
        );


    if (
        intersects.length > 0
    ) {

        const marker =
            intersects[0].object;


        const annId =
            marker.userData.annotationId;


        const pointIndex =
            marker.userData.pointIndex;


        if (
            marker.userData.isBoxHandle &&
            beginBoxHandleDrag(
                event,
                marker
            )
        ) {

            return;
        }


        state.draggedAnnotation =
            state.annotations.find(
                a =>
                    a.id === annId
            );


        if (
            state.draggedAnnotation
        ) {

            state.isDraggingPoint =
                true;


            state.draggedPointIndex =
                pointIndex;


            state.draggedMarker =
                marker;


            state.controls.enabled =
                false;


            dom.canvas.style.cursor =
                'grabbing';
        }
    }


    // ========================================================
    // Box body
    // ========================================================

    if (
        !state.isDraggingPoint &&
        !state.isManipulatingBox
    ) {

        beginBoxBodyDrag(
            event,
            raycaster
        );
    }
}


// ============================================================
// Hover cursor
// ============================================================

function updateHoverCursor(mouse) {

    if (
        !state.currentTool &&
        state.currentModel
    ) {

        const raycaster =
            new THREE.Raycaster();


        raycaster.setFromCamera(
            mouse,
            state.camera
        );


        // ----------------------------------------------------
        // Annotation point / box handle
        // ----------------------------------------------------

        const markerObjects =
            state.annotationObjects.children.filter(

                obj =>
                    obj.userData.isAnnotationMarker &&
                    obj.isMesh
            );


        const markerIntersects =
            raycaster.intersectObjects(
                markerObjects
            );


        if (
            markerIntersects.length > 0
        ) {

            const hitMarker =
                markerIntersects[0].object;


            if (
                hitMarker.userData.isBoxHandle
            ) {

                dom.canvas.style.cursor =
                    'nwse-resize';

            } else {

                dom.canvas.style.cursor =
                    'grab';
            }


            return;
        }


        // ----------------------------------------------------
        // Box body
        // ----------------------------------------------------

        const boxObjects =
            state.annotationObjects.children.filter(

                obj =>
                    obj.userData.isBoxBody &&
                    obj.isMesh
            );


        const boxIntersects =
            raycaster.intersectObjects(
                boxObjects
            );


        if (
            boxIntersects.length > 0
        ) {

            dom.canvas.style.cursor =
                'move';

        } else {

            dom.canvas.style.cursor =
                'default';
        }
    }
}


// ============================================================
// Canvas Pointer Move
// ============================================================

export function onCanvasPointerMove(event) {

    const rect =
        dom.canvas
            .getBoundingClientRect();


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


    // ========================================================
    // SURFACE PAINT
    // ========================================================

    if (
        state.isPaintingSurface &&
        state.currentTool === 'surface' &&
        state.currentModel
    ) {

        queuePaintInput(
            event.clientX,
            event.clientY,
            event.shiftKey
        );


        return;
    }


    // ========================================================
    // DRAG ANNOTATION POINT
    // ========================================================

    if (
        state.isDraggingPoint &&
        state.draggedMarker &&
        state.currentModel
    ) {

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


        if (
            intersects.length > 0
        ) {

            const hit =
                intersects[0];


            const newPos =
                hit.point.clone();


            state.draggedMarker.position.copy(
                newPos
            );


            if (
                state.draggedAnnotation &&
                state.draggedPointIndex >= 0
            ) {

                // ------------------------------------------------
                // Store the new point
                // ------------------------------------------------

                const storagePos =
                    toStorageCoords(
                        newPos
                    );


                const updatedPoint = {

                    x:
                        storagePos.x,

                    y:
                        storagePos.y,

                    z:
                        storagePos.z
                };


                // =================================================
                // POINT ANNOTATION:
                // Recalculate surface normal after dragging
                // =================================================

                if (
                    state.draggedAnnotation.type === 'point'
                ) {

                    const newNormal =
                        getNormalFromIntersection(
                            hit
                        );


                    if (
                        newNormal
                    ) {

                        /*
                         * Convert normal into the same
                         * non-flipped storage coordinate system
                         * used by the point.
                         */
                        const storageNormal =
                            toStorageCoords(
                                newNormal
                            );


                        updatedPoint.nx =
                            storageNormal.x;


                        updatedPoint.ny =
                            storageNormal.y;


                        updatedPoint.nz =
                            storageNormal.z;
                    }
                }


                // ------------------------------------------------
                // Update stored annotation point
                // ------------------------------------------------

                state.draggedAnnotation
                    .points[
                        state.draggedPointIndex
                    ] =
                        updatedPoint;


                // ------------------------------------------------
                // Line / polygon surface projection
                // ------------------------------------------------

                if (
                    state.draggedAnnotation.projectedEdges &&
                    state.draggedAnnotation.surfaceProjection
                ) {

                    recomputeAdjacentEdgesFlipAware(
                        state.draggedAnnotation,
                        state.draggedPointIndex
                    );
                }


                // ------------------------------------------------
                // Re-render
                // ------------------------------------------------

                renderAnnotations();


                /*
                 * renderAnnotations() deletes and recreates
                 * the marker objects. Therefore obtain the
                 * newly created marker again.
                 */
                const markers =
                    state.annotationObjects.children.filter(

                        obj =>
                            obj.userData.isAnnotationMarker &&
                            obj.userData.annotationId ===
                                state.draggedAnnotation.id &&
                            obj.userData.pointIndex ===
                                state.draggedPointIndex
                    );


                if (
                    markers.length > 0
                ) {

                    state.draggedMarker =
                        markers[0];
                }
            }
        }


        return;
    }


    // ========================================================
    // Pending box manipulation
    // ========================================================

    if (
        state.isManipulatingBox &&
        state.isBoxPlacementMode &&
        state.pendingBoxData &&
        state.boxDragStartData
    ) {

        updatePendingBoxManipulation(
            event,
            mouse
        );


        return;
    }


    // ========================================================
    // Existing box manipulation
    // ========================================================

    if (
        state.isManipulatingBox &&
        state.selectedBoxAnnotation &&
        state.boxDragStartData
    ) {

        updateSelectedBoxManipulation(
            event,
            mouse
        );


        return;
    }


    // ========================================================
    // Hover
    // ========================================================

    updateHoverCursor(
        mouse
    );
}


// ============================================================
// Canvas Pointer Up
// ============================================================

export function onCanvasPointerUp(event) {

    // ========================================================
    // Finish surface painting
    // ========================================================

    if (
        state.isPaintingSurface
    ) {

        if (
            state.currentStrokeAdded ||
            state.currentStrokeRemoved
        ) {

            const added =
                state.currentStrokeAdded ||
                new Set();


            const removed =
                state.currentStrokeRemoved ||
                new Set();


            if (
                added.size > 0 ||
                removed.size > 0
            ) {

                state.surfaceStrokeHistory.push({
                    added,
                    removed
                });
            }


            state.currentStrokeAdded =
                null;


            state.currentStrokeRemoved =
                null;
        }


        state.isPaintingSurface =
            false;


        state.controls.enabled =
            true;


        _stopPaintLoop();
    }


    // ========================================================
    // Finish pending box manipulation
    // ========================================================

    if (
        state.isManipulatingBox &&
        state.isBoxPlacementMode &&
        state.pendingBoxData
    ) {

        endPendingBoxManipulation();

        return;
    }


    // ========================================================
    // Finish annotation point dragging
    // ========================================================

    if (
        state.isDraggingPoint
    ) {

        state.wasDragging =
            true;


        if (
            state.draggedAnnotation &&
            state.draggedAnnotation.surfaceProjection &&
            (
                state.draggedAnnotation.type === 'line' ||
                state.draggedAnnotation.type === 'polygon'
            )
        ) {

            state.draggedAnnotation.projectedEdges =
                computeProjectedEdgesFlipAware(

                    state.draggedAnnotation.points,

                    state.draggedAnnotation.type ===
                        'polygon'
                );
        }


        state.isDraggingPoint =
            false;


        state.draggedAnnotation =
            null;


        state.draggedPointIndex =
            -1;


        state.draggedMarker =
            null;


        state.controls.enabled =
            true;


        dom.canvas.style.cursor =
            'default';


        renderAnnotations();

        updateGroupsList();

        showStatus(
            'Point moved'
        );
    }


    // ========================================================
    // Finish box manipulation
    // ========================================================

    if (
        state.isManipulatingBox
    ) {

        endSelectedBoxManipulation();
    }
}


// ============================================================
// Re-exports
// ============================================================

// ============ Re-exported from ./measure.js ============

export {
    undoLastMeasurePoint,
    updateMeasurementsDisplay,
    deleteMeasurement,
    clearAllMeasurements,
    renderMeasurements
} from './measure.js';


// ============ Re-exported from ./surface-paint.js ============

export {
    scheduleSurfaceHighlight,
    updateSurfaceHighlight,
    undoLastSurfaceStroke
} from './surface-paint.js';


export {
    getIntersectionWithFace,
    paintAtPoint,
    finishSurfacePainting,
    clearTempSurface
};


// ============ Re-exported from ./drawing.js ============

export {
    undoLastPoint
} from './drawing.js';
