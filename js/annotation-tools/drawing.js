// js/annotation-tools/drawing.js
// Point / line / polygon drawing helpers

import * as THREE from 'three';

import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

import { state } from '../state.js';

import {
    showStatus,
    toStorageCoords
} from '../utils/helpers.js';

import {
    getViewportWidth,
    getViewportHeight
} from '../core/scene.js';

import {
    projectEdgeToSurface,
    isProjectionAcceptable
} from './projection.js';


// ============================================================
// Late-bound callbacks
// ============================================================

let _openAnnotationPopup = null;
let _setTool = null;


export function setDrawingCallbacks({
    openAnnotationPopup,
    setTool
}) {

    _openAnnotationPopup =
        openAnnotationPopup;

    _setTool =
        setTool;
}


// ============================================================
// Undo
// ============================================================

export function undoLastPoint() {

    if (
        state.tempPoints.length === 0
    ) {
        return false;
    }


    state.tempPoints.pop();


    if (
        state.tempProjectedEdges.length > 0 &&
        state.tempProjectedEdges.length >=
        state.tempPoints.length
    ) {

        state.tempProjectedEdges.pop();
    }


    updateTempLine();


    const remaining =
        state.tempPoints.length;


    if (
        remaining === 0
    ) {

        showStatus(
            'All points removed. Click to start again.'
        );

    } else {

        showStatus(
            `Point removed. ${remaining} point${remaining !== 1 ? 's' : ''} remaining.`
        );
    }


    return true;
}


// ============================================================
// Temporary line
// ============================================================

export function updateTempLine() {

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


    if (
        state.tempPoints.length < 2
    ) {
        return;
    }


    const positions =
        [];


    if (
        state.surfaceProjectionEnabled &&
        state.modelMeshes.length > 0
    ) {

        for (
            let i = 0;
            i < state.tempPoints.length - 1;
            i++
        ) {

            let edgePoints;


            if (
                i < state.tempProjectedEdges.length &&
                state.tempProjectedEdges[i]
            ) {

                edgePoints =
                    state.tempProjectedEdges[i];

            } else {

                const projected =
                    projectEdgeToSurface(
                        state.tempPoints[i],
                        state.tempPoints[i + 1],
                        20
                    );


                const straightFallback = [

                    {
                        x: state.tempPoints[i].x,
                        y: state.tempPoints[i].y,
                        z: state.tempPoints[i].z
                    },

                    {
                        x: state.tempPoints[i + 1].x,
                        y: state.tempPoints[i + 1].y,
                        z: state.tempPoints[i + 1].z
                    }
                ];


                if (
                    projected &&
                    isProjectionAcceptable(
                        projected,
                        state.tempPoints[i],
                        state.tempPoints[i + 1]
                    )
                ) {

                    edgePoints =
                        projected;

                } else {

                    edgePoints =
                        straightFallback;
                }


                if (
                    i <
                    state.tempPoints.length - 2
                ) {

                    state.tempProjectedEdges[i] =
                        edgePoints;
                }
            }


            const startIdx =
                i === 0
                    ? 0
                    : 1;


            for (
                let j = startIdx;
                j < edgePoints.length;
                j++
            ) {

                positions.push(
                    edgePoints[j].x,
                    edgePoints[j].y,
                    edgePoints[j].z
                );
            }
        }

    } else {

        state.tempPoints.forEach(
            p => {

                positions.push(
                    p.x,
                    p.y,
                    p.z
                );
            }
        );
    }


    const geometry =
        new LineGeometry();


    geometry.setPositions(
        positions
    );


    const material =
        new LineMaterial({

            color:
                0xEDC040,

            linewidth:
                3,

            resolution:
                new THREE.Vector2(
                    getViewportWidth(),
                    getViewportHeight()
                ),

            polygonOffset:
                true,

            polygonOffsetFactor:
                -4,

            polygonOffsetUnits:
                -4
        });


    state.tempLine =
        new Line2(
            geometry,
            material
        );


    state.annotationObjects.add(
        state.tempLine
    );
}


// ============================================================
// Point annotation
// ============================================================

/**
 * Save clicked point together with its surface normal.
 *
 * normal is a WORLD/DISPLAY-space normal calculated
 * from the triangle that was clicked.
 */
export function handlePointTap(
    event,
    point,
    normal = null
) {

    const pointToUse =
        state.pendingPointPosition ||
        point;


    const normalToUse =
        state.pendingPointNormal ||
        normal;


    state.pendingPointPosition =
        null;


    state.pendingPointNormal =
        null;


    if (
        !pointToUse
    ) {
        return;
    }


    // --------------------------------------------------------
    // Convert point to non-flipped storage coordinates
    // --------------------------------------------------------

    const storagePoint =
        toStorageCoords(
            pointToUse
        );


    const pointData = {

        x:
            storagePoint.x,

        y:
            storagePoint.y,

        z:
            storagePoint.z
    };


    // --------------------------------------------------------
    // Store surface normal with point
    //
    // Flip transform is a 180° rotation about X:
    // x -> x
    // y -> -y
    // z -> -z
    //
    // Therefore the same transform is valid for a direction
    // vector such as the normal.
    // --------------------------------------------------------

    if (
        normalToUse
    ) {

        const storageNormal =
            toStorageCoords(
                normalToUse
            );


        pointData.nx =
            storageNormal.x;

        pointData.ny =
            storageNormal.y;

        pointData.nz =
            storageNormal.z;
    }


    _openAnnotationPopup(
        event,
        'point',
        [pointData]
    );


    _setTool(
        null
    );
}


// ============================================================
// Line / Polygon
// ============================================================

export function addDrawingPoint(
    point
) {

    state.tempPoints.push(
        point
    );


    updateTempLine();
}


export function finishDrawing(
    event,
    type
) {

    const storagePoints =
        state.tempPoints.map(
            p =>
                toStorageCoords(
                    p
                )
        );


    _openAnnotationPopup(
        event,
        type,
        storagePoints
    );


    _setTool(
        null
    );
}
