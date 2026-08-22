// js/annotation-tools/render.js

import * as THREE from 'three';

import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

import { state } from '../state.js';

import {
    createScaledTextSprite,
    getViewportWidth,
    getViewportHeight
} from '../core/scene.js';

import {
    toDisplayCoords,
    boxDisplayQuaternion
} from '../utils/helpers.js';

import {
    forceOcclusionUpdate
} from '../utils/label-occlusion.js';


// ============================================================
// Late-bound reference
// ============================================================

let _renderMeasurements = null;


export function setRenderCallbacks({
    renderMeasurements
}) {
    _renderMeasurements = renderMeasurements;
}


// ============================================================
// Reusable raycaster for silhouette search
// ============================================================

const _leaderRaycaster =
    new THREE.Raycaster();


const _leaderMouse =
    new THREE.Vector2();


// ============================================================
// Test whether a screen position intersects the model
// ============================================================

function screenPixelHitsModel(
    pixelX,
    pixelY,
    width,
    height
) {

    if (
        !state.camera ||
        !state.currentModel ||
        width <= 0 ||
        height <= 0
    ) {
        return false;
    }


    // --------------------------------------------------------
    // Screen pixel -> Normalized Device Coordinates
    // --------------------------------------------------------

    _leaderMouse.set(

        (
            pixelX /
            width
        ) * 2 - 1,

        -(
            (
                pixelY /
                height
            ) * 2 - 1
        )
    );


    _leaderRaycaster.setFromCamera(
        _leaderMouse,
        state.camera
    );


    /*
     * Use modelMeshes where possible.
     *
     * This is more direct than intersecting annotation
     * objects or other scene objects.
     */
    let hits;


    if (
        state.modelMeshes &&
        state.modelMeshes.length > 0
    ) {

        hits =
            _leaderRaycaster.intersectObjects(
                state.modelMeshes,
                false
            );

    } else {

        hits =
            _leaderRaycaster.intersectObject(
                state.currentModel,
                true
            );
    }


    return (
        hits.length >
        0
    );
}


// ============================================================
// Find shortest screen-space route from point to model exterior
// ============================================================

function findNearestOutsideDirection(
    pointPosition
) {

    const width =
        Math.max(
            1,
            getViewportWidth()
        );


    const height =
        Math.max(
            1,
            getViewportHeight()
        );


    // --------------------------------------------------------
    // Project selected 3D point onto current screen
    // --------------------------------------------------------

    const projected =
        pointPosition
            .clone()
            .project(
                state.camera
            );


    const startX =
        (
            projected.x +
            1
        )
        *
        0.5
        *
        width;


    const startY =
        (
            1 -
            projected.y
        )
        *
        0.5
        *
        height;


    // ========================================================
    // Search parameters
    // ========================================================

    /*
     * 72 directions =
     * one direction every 5 degrees.
     *
     * More directions = more precise silhouette search.
     */
    const DIRECTION_COUNT =
        72;


    /*
     * Examine the screen every 4 pixels.
     */
    const STEP_PX =
        4;


    /*
     * Once background is encountered, require this
     * many consecutive background samples before
     * accepting it as the real outer silhouette.
     *
     * 10 × 4 px = 40 px background.
     *
     * This helps prevent anatomical holes from being
     * interpreted as the outside of the entire model.
     */
    const CLEAR_SAMPLES =
        10;


    /*
     * Do not search indefinitely.
     */
    const maxDistance =
        Math.sqrt(
            width * width +
            height * height
        );


    let bestDirection =
        null;


    let bestExitDistance =
        Infinity;


    // ========================================================
    // Examine every radial screen direction
    // ========================================================

    for (
        let i = 0;
        i < DIRECTION_COUNT;
        i++
    ) {

        const angle =
            (
                i /
                DIRECTION_COUNT
            )
            *
            Math.PI
            *
            2;


        const dx =
            Math.cos(
                angle
            );


        const dy =
            Math.sin(
                angle
            );


        let firstOutsideDistance =
            null;


        let consecutiveOutside =
            0;


        // ----------------------------------------------------
        // Walk outward from selected point
        // ----------------------------------------------------

        for (
            let distance = STEP_PX;
            distance <= maxDistance;
            distance += STEP_PX
        ) {

            const x =
                startX +
                dx *
                distance;


            const y =
                startY +
                dy *
                distance;


            // ------------------------------------------------
            // Screen edge = definitely outside model
            // ------------------------------------------------

            if (
                x < 0 ||
                x >= width ||
                y < 0 ||
                y >= height
            ) {

                if (
                    firstOutsideDistance !== null &&
                    firstOutsideDistance <
                    bestExitDistance
                ) {

                    bestExitDistance =
                        firstOutsideDistance;


                    bestDirection = {
                        dx,
                        dy
                    };
                }


                break;
            }


            // ------------------------------------------------
            // Does this screen pixel still hit anatomy?
            // ------------------------------------------------

            const hitsModel =
                screenPixelHitsModel(
                    x,
                    y,
                    width,
                    height
                );


            if (
                hitsModel
            ) {

                /*
                 * We entered anatomy again.
                 *
                 * Therefore any preceding empty section was
                 * probably an internal hole/gap rather than
                 * the true external silhouette.
                 */
                firstOutsideDistance =
                    null;


                consecutiveOutside =
                    0;

            } else {

                if (
                    firstOutsideDistance ===
                    null
                ) {

                    firstOutsideDistance =
                        distance;
                }


                consecutiveOutside++;


                // --------------------------------------------
                // Enough continuous background:
                // accept this as actual exterior
                // --------------------------------------------

                if (
                    consecutiveOutside >=
                    CLEAR_SAMPLES
                ) {

                    if (
                        firstOutsideDistance <
                        bestExitDistance
                    ) {

                        bestExitDistance =
                            firstOutsideDistance;


                        bestDirection = {
                            dx,
                            dy
                        };
                    }


                    break;
                }
            }
        }
    }


    // ========================================================
    // Fallback
    // ========================================================

    if (
        !bestDirection ||
        !Number.isFinite(
            bestExitDistance
        )
    ) {

        /*
         * Only used if silhouette search completely fails.
         *
         * Choose screen-right.
         */
        bestDirection = {
            dx: 1,
            dy: 0
        };


        bestExitDistance =
            100;
    }


    return {

        dx:
            bestDirection.dx,

        dy:
            bestDirection.dy,

        distance:
            bestExitDistance,

        startX,
        startY,

        ndcZ:
            projected.z,

        width,
        height
    };
}


// ============================================================
// Screen pixel position -> world position at specified NDC depth
// ============================================================

function screenPixelToWorld(
    pixelX,
    pixelY,
    ndcZ,
    width,
    height
) {

    const ndcX =
        (
            pixelX /
            width
        )
        *
        2
        -
        1;


    const ndcY =
        -(
            (
                pixelY /
                height
            )
            *
            2
            -
            1
        );


    return new THREE.Vector3(
        ndcX,
        ndcY,
        ndcZ
    )
        .unproject(
            state.camera
        );
}


// ============================================================
// Render Annotations
// ============================================================

export function renderAnnotations() {

    // --------------------------------------------------------
    // Clear existing annotation objects
    // --------------------------------------------------------

    while (
        state.annotationObjects.children.length >
        0
    ) {

        const child =
            state.annotationObjects.children[0];


        if (
            child.geometry
        ) {

            child.geometry.dispose();
        }


        if (
            child.material
        ) {

            const mats =
                Array.isArray(
                    child.material
                )
                    ? child.material
                    : [child.material];


            mats.forEach(
                m => {

                    if (
                        m.map
                    ) {

                        m.map.dispose();
                    }


                    m.dispose();
                }
            );
        }


        state.annotationObjects.remove(
            child
        );
    }


    // --------------------------------------------------------
    // Model size
    // --------------------------------------------------------

    const modelBox =
        state.currentModel
            ? new THREE.Box3()
                .setFromObject(
                    state.currentModel
                )
            : new THREE.Box3(
                new THREE.Vector3(
                    -0.5,
                    -0.5,
                    -0.5
                ),
                new THREE.Vector3(
                    0.5,
                    0.5,
                    0.5
                )
            );


    const modelSize =
        modelBox.getSize(
            new THREE.Vector3()
        );


    const maxDim =
        Math.max(
            modelSize.x,
            modelSize.y,
            modelSize.z
        );


    const labelOffset =
        Math.pow(
            maxDim,
            0.8
        )
        *
        0.012;


    // ========================================================
    // Point leader settings
    // ========================================================

    /*
     * Distance after actual silhouette before the
     * visible external part of the leader continues.
     */
    const OUTSIDE_MARGIN_PX =
        12;


    /*
     * Additional distance from exterior silhouette
     * to label center.
     *
     * Increase this if label should be farther away.
     */
    const LABEL_EXTENSION_PX =
        120;


    // --------------------------------------------------------
    // Each annotation
    // --------------------------------------------------------

    state.annotations.forEach(
        ann => {

            const group =
                state.groups.find(
                    g =>
                        g.id === ann.groupId
                );


            if (
                !group ||
                !group.visible
            ) {

                return;
            }


            const color =
                new THREE.Color(
                    group.color
                );


            const groupOpacity =
                group.opacity !== undefined
                    ? group.opacity
                    : 1.0;


            let labelPosition;

            let occlusionCheckPos;


            // =================================================
            // POINT
            // =================================================

            if (
                ann.type === 'point'
            ) {

                // ---------------------------------------------
                // Annotation point
                // ---------------------------------------------

                const storedPoint =
                    ann.points[0];


                const dp =
                    toDisplayCoords(
                        storedPoint
                    );


                const pointPosition =
                    new THREE.Vector3(
                        dp.x,
                        dp.y,
                        dp.z
                    );


                // ---------------------------------------------
                // Point marker
                // ---------------------------------------------

                const geometry =
                    new THREE.SphereGeometry(
                        0.02,
                        16,
                        16
                    );


                const material =
                    new THREE.MeshBasicMaterial({

                        color,

                        transparent:
                            groupOpacity <
                            1,

                        opacity:
                            groupOpacity
                    });


                const marker =
                    new THREE.Mesh(
                        geometry,
                        material
                    );


                marker.position.copy(
                    pointPosition
                );


                marker.scale.setScalar(

                    Math.pow(
                        maxDim,
                        0.8
                    )
                    *
                    0.025
                    *
                    state.pointSizeMultiplier
                );


                marker.userData.annotationId =
                    ann.id;


                marker.userData.pointIndex =
                    0;


                marker.userData.isAnnotationMarker =
                    true;


                state.annotationObjects.add(
                    marker
                );


                // =============================================
                // Find actual shortest route to model exterior
                // =============================================

                const exitInfo =
                    findNearestOutsideDirection(
                        pointPosition
                    );


                const {
                    width,
                    height
                } =
                    exitInfo;


                // ---------------------------------------------
                // Actual external silhouette position
                // ---------------------------------------------

                const silhouetteX =
                    exitInfo.startX +
                    exitInfo.dx *
                    exitInfo.distance;


                const silhouetteY =
                    exitInfo.startY +
                    exitInfo.dy *
                    exitInfo.distance;


                // ---------------------------------------------
                // Move a little beyond silhouette
                // ---------------------------------------------

                const outsideX =
                    silhouetteX +
                    exitInfo.dx *
                    OUTSIDE_MARGIN_PX;


                const outsideY =
                    silhouetteY +
                    exitInfo.dy *
                    OUTSIDE_MARGIN_PX;


                // ---------------------------------------------
                // Label position further outward
                // ---------------------------------------------

                const labelX =
                    outsideX +
                    exitInfo.dx *
                    LABEL_EXTENSION_PX;


                const labelY =
                    outsideY +
                    exitInfo.dy *
                    LABEL_EXTENSION_PX;


                // =============================================
                // Convert screen locations to world coordinates
                // =============================================

                const silhouettePosition =
                    screenPixelToWorld(
                        silhouetteX,
                        silhouetteY,
                        exitInfo.ndcZ,
                        width,
                        height
                    );


                const outsidePosition =
                    screenPixelToWorld(
                        outsideX,
                        outsideY,
                        exitInfo.ndcZ,
                        width,
                        height
                    );


                labelPosition =
                    screenPixelToWorld(
                        labelX,
                        labelY,
                        exitInfo.ndcZ,
                        width,
                        height
                    );


                // =============================================
                // Leader line
                //
                // point
                //   -> nearest silhouette
                //   -> just outside anatomy
                //   -> label
                // =============================================

                const leaderGeometry =
                    new LineGeometry();


                leaderGeometry.setPositions([

                    // selected point
                    pointPosition.x,
                    pointPosition.y,
                    pointPosition.z,

                    // nearest model silhouette
                    silhouettePosition.x,
                    silhouettePosition.y,
                    silhouettePosition.z,

                    // slightly outside model
                    outsidePosition.x,
                    outsidePosition.y,
                    outsidePosition.z,

                    // label
                    labelPosition.x,
                    labelPosition.y,
                    labelPosition.z
                ]);


                const leaderMaterial =
                    new LineMaterial({

                        color:
                            color,

                        linewidth:
                            3,

                        transparent:
                            groupOpacity <
                            1,

                        opacity:
                            groupOpacity,

                        resolution:
                            new THREE.Vector2(
                                width,
                                height
                            ),

                        /*
                         * Keep leader visible from selected point
                         * to outside.
                         *
                         * The algorithm itself minimizes how much
                         * anatomy the first segment crosses.
                         */
                        depthTest:
                            false
                    });


                const leader =
                    new Line2(
                        leaderGeometry,
                        leaderMaterial
                    );


                leader.userData.annotationId =
                    ann.id;


                leader.renderOrder =
                    9998;


                state.annotationObjects.add(
                    leader
                );


                // ---------------------------------------------
                // Occlusion check
                // ---------------------------------------------

                occlusionCheckPos =
                    pointPosition.clone();
            }


            // =================================================
            // LINE / POLYGON
            // =================================================

            else if (
                ann.type === 'line' ||
                ann.type === 'polygon'
            ) {

                const positions =
                    [];


                if (
                    ann.projectedEdges &&
                    ann.surfaceProjection &&
                    ann.projectedEdges.length >
                    0
                ) {

                    ann.projectedEdges.forEach(
                        (
                            edge,
                            edgeIdx
                        ) => {

                            const startIdx =
                                edgeIdx ===
                                0
                                    ? 0
                                    : 1;


                            for (
                                let j =
                                    startIdx;
                                j <
                                edge.length;
                                j++
                            ) {

                                const ep =
                                    toDisplayCoords(
                                        edge[j]
                                    );


                                positions.push(
                                    ep.x,
                                    ep.y,
                                    ep.z
                                );
                            }
                        }
                    );

                } else {

                    const points =
                        ann.points.map(
                            p => {

                                const d =
                                    toDisplayCoords(
                                        p
                                    );


                                return new THREE.Vector3(
                                    d.x,
                                    d.y,
                                    d.z
                                );
                            }
                        );


                    if (
                        ann.type ===
                            'polygon' &&
                        points.length >
                            0
                    ) {

                        points.push(
                            points[0]
                                .clone()
                        );
                    }


                    points.forEach(
                        p => {

                            positions.push(
                                p.x,
                                p.y,
                                p.z
                            );
                        }
                    );
                }


                // ---------------------------------------------
                // Line
                // ---------------------------------------------

                const lineGeometry =
                    new LineGeometry();


                lineGeometry.setPositions(
                    positions
                );


                const lineMaterial =
                    new LineMaterial({

                        color:
                            color,

                        linewidth:
                            3,

                        transparent:
                            groupOpacity <
                            1,

                        opacity:
                            groupOpacity,

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


                const line =
                    new Line2(
                        lineGeometry,
                        lineMaterial
                    );


                line.userData.annotationId =
                    ann.id;


                state.annotationObjects.add(
                    line
                );


                // ---------------------------------------------
                // Point markers
                // ---------------------------------------------

                ann.points.forEach(
                    (
                        p,
                        index
                    ) => {

                        const geometry =
                            new THREE.SphereGeometry(
                                0.02,
                                12,
                                12
                            );


                        const material =
                            new THREE.MeshBasicMaterial({

                                color,

                                transparent:
                                    groupOpacity <
                                    1,

                                opacity:
                                    groupOpacity
                            });


                        const marker =
                            new THREE.Mesh(
                                geometry,
                                material
                            );


                        const vp =
                            toDisplayCoords(
                                p
                            );


                        marker.position.set(
                            vp.x,
                            vp.y,
                            vp.z
                        );


                        marker.scale.setScalar(

                            Math.pow(
                                maxDim,
                                0.8
                            )
                            *
                            0.018
                            *
                            state.pointSizeMultiplier
                        );


                        marker.userData.annotationId =
                            ann.id;


                        marker.userData.pointIndex =
                            index;


                        marker.userData.isAnnotationMarker =
                            true;


                        state.annotationObjects.add(
                            marker
                        );
                    }
                );


                // ---------------------------------------------
                // Polygon label
                // ---------------------------------------------

                if (
                    ann.type ===
                        'polygon' &&
                    ann.points.length >
                        0
                ) {

                    const centroid =
                        ann.points.reduce(

                            (
                                acc,
                                p
                            ) => {

                                const d =
                                    toDisplayCoords(
                                        p
                                    );


                                return {

                                    x:
                                        acc.x +
                                        d.x,

                                    y:
                                        acc.y +
                                        d.y,

                                    z:
                                        acc.z +
                                        d.z
                                };
                            },

                            {
                                x: 0,
                                y: 0,
                                z: 0
                            }
                        );


                    labelPosition =
                        new THREE.Vector3(

                            centroid.x /
                                ann.points.length,

                            centroid.y /
                                ann.points.length +
                                labelOffset,

                            centroid.z /
                                ann.points.length
                        );


                    occlusionCheckPos =
                        new THREE.Vector3(

                            centroid.x /
                                ann.points.length,

                            centroid.y /
                                ann.points.length,

                            centroid.z /
                                ann.points.length
                        );

                } else if (
                    ann.points.length >
                    0
                ) {

                    const lp =
                        toDisplayCoords(
                            ann.points[0]
                        );


                    labelPosition =
                        new THREE.Vector3(

                            lp.x,

                            lp.y +
                                labelOffset,

                            lp.z
                        );


                    occlusionCheckPos =
                        new THREE.Vector3(
                            lp.x,
                            lp.y,
                            lp.z
                        );
                }
            }


            // =================================================
            // SURFACE
            // =================================================

            else if (
                ann.type === 'surface' &&
                ann.faceData
            ) {

                const surfaceMesh =
                    renderSurfaceAnnotation(
                        ann,
                        color,
                        groupOpacity
                    );


                if (
                    surfaceMesh
                ) {

                    surfaceMesh.userData.annotationId =
                        ann.id;


                    state.annotationObjects.add(
                        surfaceMesh
                    );
                }


                if (
                    ann.points &&
                    ann.points.length >
                    0
                ) {

                    const sp =
                        toDisplayCoords(
                            ann.points[0]
                        );


                    labelPosition =
                        new THREE.Vector3(

                            sp.x,

                            sp.y +
                                labelOffset,

                            sp.z
                        );


                    occlusionCheckPos =
                        new THREE.Vector3(
                            sp.x,
                            sp.y,
                            sp.z
                        );
                }
            }


            // =================================================
            // BOX
            // =================================================

            else if (
                ann.type === 'box' &&
                ann.boxData
            ) {

                const boxObjects =
                    renderBoxAnnotation(
                        ann,
                        color,
                        maxDim,
                        groupOpacity
                    );


                if (
                    boxObjects
                ) {

                    boxObjects.forEach(
                        obj => {

                            obj.userData.annotationId =
                                ann.id;


                            state.annotationObjects.add(
                                obj
                            );
                        }
                    );
                }


                const bc =
                    toDisplayCoords(
                        ann.boxData.center
                    );


                const size =
                    ann.boxData.size;


                const yOffset =
                    state.isFlipped

                        ? -(
                            size.y /
                                2 +
                            labelOffset
                        )

                        : (
                            size.y /
                                2 +
                            labelOffset
                        );


                labelPosition =
                    new THREE.Vector3(

                        bc.x,

                        bc.y +
                            yOffset,

                        bc.z
                    );


                occlusionCheckPos =
                    new THREE.Vector3(
                        bc.x,
                        bc.y,
                        bc.z
                    );
            }


            // =================================================
            // LABEL
            // =================================================

            if (
                ann.name &&
                labelPosition
            ) {

                const label =
                    createScaledTextSprite(
                        ann.name,
                        group.color,
                        labelPosition,
                        0.8
                    );


                if (
                    groupOpacity <
                    1
                ) {

                    label.material.opacity =
                        groupOpacity;
                }


                label.userData.annotationId =
                    ann.id;


                if (
                    occlusionCheckPos
                ) {

                    label.userData.occlusionCheckPosition =
                        occlusionCheckPos;
                }


                state.annotationObjects.add(
                    label
                );
            }
        }
    );


    // --------------------------------------------------------
    // Measurements
    // --------------------------------------------------------

    if (
        _renderMeasurements
    ) {

        _renderMeasurements();
    }


    // --------------------------------------------------------
    // Label occlusion
    // --------------------------------------------------------

    forceOcclusionUpdate();
}


// ============================================================
// Surface Annotation
// ============================================================

export function renderSurfaceAnnotation(
    ann,
    color,
    groupOpacity = 1.0
) {

    if (
        !ann.faceData ||
        ann.faceData.length ===
        0
    ) {

        return null;
    }


    const facesByMesh =
        new Map();


    ann.faceData.forEach(
        faceId => {

            const [
                meshIdx,
                faceIdx
            ] =
                faceId.split(
                    '_'
                );


            if (
                !facesByMesh.has(
                    meshIdx
                )
            ) {

                facesByMesh.set(
                    meshIdx,
                    []
                );
            }


            facesByMesh
                .get(
                    meshIdx
                )
                .push(
                    parseInt(
                        faceIdx
                    )
                );
        }
    );


    const vertices =
        [];


    facesByMesh.forEach(
        (
            faceIndices,
            meshIdx
        ) => {

            const mesh =
                state.modelMeshes[
                    parseInt(
                        meshIdx
                    )
                ];


            if (
                !mesh
            ) {

                return;
            }


            const geometry =
                mesh.geometry;


            const position =
                geometry.attributes.position;


            faceIndices.forEach(
                faceIdx => {

                    let a;
                    let b;
                    let c;


                    if (
                        geometry.index
                    ) {

                        a =
                            geometry.index.getX(
                                faceIdx *
                                3
                            );


                        b =
                            geometry.index.getX(
                                faceIdx *
                                3 +
                                1
                            );


                        c =
                            geometry.index.getX(
                                faceIdx *
                                3 +
                                2
                            );

                    } else {

                        a =
                            faceIdx *
                            3;


                        b =
                            faceIdx *
                            3 +
                            1;


                        c =
                            faceIdx *
                            3 +
                            2;
                    }


                    const vA =
                        new THREE.Vector3()
                            .fromBufferAttribute(
                                position,
                                a
                            );


                    const vB =
                        new THREE.Vector3()
                            .fromBufferAttribute(
                                position,
                                b
                            );


                    const vC =
                        new THREE.Vector3()
                            .fromBufferAttribute(
                                position,
                                c
                            );


                    vA.applyMatrix4(
                        mesh.matrixWorld
                    );


                    vB.applyMatrix4(
                        mesh.matrixWorld
                    );


                    vC.applyMatrix4(
                        mesh.matrixWorld
                    );


                    vertices.push(
                        vA.x,
                        vA.y,
                        vA.z
                    );


                    vertices.push(
                        vB.x,
                        vB.y,
                        vB.z
                    );


                    vertices.push(
                        vC.x,
                        vC.y,
                        vC.z
                    );
                }
            );
        }
    );


    if (
        vertices.length ===
        0
    ) {

        return null;
    }


    const highlightGeometry =
        new THREE.BufferGeometry();


    highlightGeometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
            vertices,
            3
        )
    );


    highlightGeometry.computeVertexNormals();


    const highlightMaterial =
        new THREE.MeshBasicMaterial({

            color:
                color,

            transparent:
                true,

            opacity:
                0.5 *
                groupOpacity,

            side:
                THREE.DoubleSide,

            depthTest:
                true,

            depthWrite:
                false,

            polygonOffset:
                true,

            polygonOffsetFactor:
                -4,

            polygonOffsetUnits:
                -4
        });


    const mesh =
        new THREE.Mesh(
            highlightGeometry,
            highlightMaterial
        );


    mesh.renderOrder =
        999;


    return mesh;
}


// ============================================================
// Box Annotation
// ============================================================

export function renderBoxAnnotation(
    ann,
    color,
    maxDim,
    groupOpacity = 1.0
) {

    if (
        !ann.boxData
    ) {

        return null;
    }


    const {
        center,
        size,
        rotation
    } =
        ann.boxData;


    const dc =
        toDisplayCoords(
            center
        );


    const objects =
        [];


    // --------------------------------------------------------
    // Editing state
    // --------------------------------------------------------

    const isUnlocked =
        state.boxEditUnlocked ===
        ann.id;


    const edgeColor =
        isUnlocked
            ? new THREE.Color(
                0xffffff
            )
            : color;


    const handleColor =
        isUnlocked
            ? new THREE.Color(
                0xffffff
            )
            : color;


    // --------------------------------------------------------
    // Box body
    // --------------------------------------------------------

    const boxGeometry =
        new THREE.BoxGeometry(
            size.x,
            size.y,
            size.z
        );


    const fillMaterial =
        new THREE.MeshBasicMaterial({

            color:
                color,

            transparent:
                true,

            opacity:
                (
                    isUnlocked
                        ? 0.35
                        : 0.25
                )
                *
                groupOpacity,

            side:
                THREE.DoubleSide,

            depthTest:
                true,

            depthWrite:
                false
        });


    const boxMesh =
        new THREE.Mesh(
            boxGeometry,
            fillMaterial
        );


    boxMesh.position.set(
        dc.x,
        dc.y,
        dc.z
    );


    const displayQuat =
        boxDisplayQuaternion(
            rotation
        );


    boxMesh.quaternion.copy(
        displayQuat
    );


    boxMesh.userData.isBoxBody =
        true;


    boxMesh.renderOrder =
        1;


    objects.push(
        boxMesh
    );


    // --------------------------------------------------------
    // Box edges
    // --------------------------------------------------------

    const edgesGeometry =
        new THREE.EdgesGeometry(
            boxGeometry
        );


    const edgesMaterial =
        new THREE.LineBasicMaterial({

            color:
                edgeColor,

            linewidth:
                2,

            transparent:
                true,

            opacity:
                1.0 *
                groupOpacity,

            depthTest:
                true,

            depthWrite:
                false
        });


    const wireframe =
        new THREE.LineSegments(
            edgesGeometry,
            edgesMaterial
        );


    wireframe.position.copy(
        boxMesh.position
    );


    wireframe.quaternion.copy(
        boxMesh.quaternion
    );


    wireframe.renderOrder =
        2;


    objects.push(
        wireframe
    );


    // --------------------------------------------------------
    // Box handles
    // --------------------------------------------------------

    const corners = [

        [-0.5, -0.5, -0.5],
        [ 0.5, -0.5, -0.5],

        [-0.5,  0.5, -0.5],
        [ 0.5,  0.5, -0.5],

        [-0.5, -0.5,  0.5],
        [ 0.5, -0.5,  0.5],

        [-0.5,  0.5,  0.5],
        [ 0.5,  0.5,  0.5]
    ];


    const handleGeometry =
        new THREE.SphereGeometry(
            0.02,
            12,
            12
        );


    corners.forEach(
        (
            corner,
            index
        ) => {

            const handleMaterial =
                new THREE.MeshBasicMaterial({

                    color:
                        handleColor,

                    transparent:
                        true,

                    opacity:
                        1.0 *
                        groupOpacity,

                    depthTest:
                        true,

                    depthWrite:
                        false
                });


            const handle =
                new THREE.Mesh(
                    handleGeometry,
                    handleMaterial
                );


            const localPos =
                new THREE.Vector3(

                    corner[0] *
                        size.x,

                    corner[1] *
                        size.y,

                    corner[2] *
                        size.z
                );


            localPos.applyQuaternion(
                displayQuat
            );


            handle.position.set(

                dc.x +
                    localPos.x,

                dc.y +
                    localPos.y,

                dc.z +
                    localPos.z
            );


            const handleScale =
                isUnlocked
                    ? 1.3
                    : 1.0;


            handle.scale.setScalar(

                Math.pow(
                    maxDim,
                    0.8
                )
                *
                0.018
                *
                state.pointSizeMultiplier
                *
                handleScale
            );


            handle.userData.isBoxHandle =
                true;


            handle.userData.handleIndex =
                index;


            handle.userData.isAnnotationMarker =
                true;


            handle.renderOrder =
                3;


            objects.push(
                handle
            );
        }
    );


    return objects;
}
