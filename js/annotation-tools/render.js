// js/annotation-tools/render.js

console.log("MODIFIED render.js LOADED - edge-label version");

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
// POINT LABEL SETTINGS
// ============================================================

/*
 * Label을 화면 가장자리에서 얼마나 안쪽에 둘지.
 *
 * 40  = 가장자리에 매우 가까움
 * 70  = 권장
 * 100 = 조금 더 안쪽
 */
const SCREEN_EDGE_MARGIN = 70;


/*
 * Point/anchor에서 바로 label까지 가지 않고
 * 약간의 여유 공간을 둘 때 사용할 수 있는 값.
 *
 * 현재는 직선으로 연결하므로 0.
 */
const POINT_START_MARGIN = 0;


// ============================================================
// Convert screen pixel coordinates to world coordinates
// at the same projected depth as the annotation point
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
        ) * 2 - 1;


    const ndcY =
        -(
            (
                pixelY /
                height
            ) * 2 - 1
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
// Choose nearest of four screen borders
// ============================================================

function getNearestScreenEdge(
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
    // 3D point -> screen NDC
    // --------------------------------------------------------

    const projected =
        pointPosition
            .clone()
            .project(
                state.camera
            );


    // --------------------------------------------------------
    // NDC -> screen pixels
    // --------------------------------------------------------

    const x =
        (
            projected.x + 1
        )
        * 0.5
        * width;


    const y =
        (
            1 - projected.y
        )
        * 0.5
        * height;


    // --------------------------------------------------------
    // Determine nearest edge using diagonal quadrants,
    // NOT raw pixel distance.
    //
    // Raw pixel distance to each of the 4 borders is heavily
    // biased on wide viewports: since height << width, the
    // distance to top/bottom is almost always smaller than the
    // distance to left/right, so 'left'/'right' would almost
    // never get selected regardless of where the point actually
    // is on screen.
    //
    // Instead we normalize the offset from screen center by
    // width/height independently (splitting the screen into 4
    // triangles via its diagonals) so all 4 directions are
    // reachable based on the point's actual quadrant, regardless
    // of aspect ratio.
    // --------------------------------------------------------

    const dx =
        (
            x -
            width / 2
        )
        / width;


    const dy =
        (
            y -
            height / 2
        )
        / height;


    let nearest;


    if (
        Math.abs(dx) >
        Math.abs(dy)
    ) {

        nearest =
            dx < 0
                ? 'left'
                : 'right';

    } else {

        nearest =
            dy < 0
                ? 'top'
                : 'bottom';
    }


    return {

        edge:
            nearest,

        x,

        y,

        ndcZ:
            projected.z,

        width,

        height
    };
}


// ============================================================
// Common: anchor world position -> label world position
// pushed toward the nearest screen edge (left/right/top/bottom)
//
// This is now shared by ALL annotation types (point, line,
// polygon, surface, box) so labels are never pushed in a
// single fixed world-space direction.
// ============================================================

function computeEdgeLabelPosition(
    anchorPosition
) {

    const edgeInfo =
        getNearestScreenEdge(
            anchorPosition
        );


    const {
        width,
        height,
        ndcZ
    } =
        edgeInfo;


    let targetX =
        edgeInfo.x;


    let targetY =
        edgeInfo.y;


    if (
        edgeInfo.edge ===
        'left'
    ) {

        targetX =
            SCREEN_EDGE_MARGIN;

    } else if (
        edgeInfo.edge ===
        'right'
    ) {

        targetX =
            width -
            SCREEN_EDGE_MARGIN;

    } else if (
        edgeInfo.edge ===
        'top'
    ) {

        targetY =
            SCREEN_EDGE_MARGIN;

    } else if (
        edgeInfo.edge ===
        'bottom'
    ) {

        targetY =
            height -
            SCREEN_EDGE_MARGIN;
    }


    return screenPixelToWorld(
        targetX,
        targetY,
        ndcZ,
        width,
        height
    );
}


// ============================================================
// Common: build the leader line connecting an anchor point
// to its label position (straight segment, always-on-top)
// ============================================================

function createLeaderLine(
    anchorPosition,
    labelPosition,
    color,
    groupOpacity,
    width,
    height
) {

    let leaderStart =
        anchorPosition.clone();


    /*
     * Normally POINT_START_MARGIN = 0,
     * so the line starts exactly from the anchor point.
     */
    if (
        POINT_START_MARGIN >
        0
    ) {

        const direction =
            new THREE.Vector3()
                .subVectors(
                    labelPosition,
                    anchorPosition
                );


        if (
            direction.lengthSq() >
            1e-12
        ) {

            direction.normalize();


            leaderStart =
                anchorPosition
                    .clone()
                    .add(
                        direction
                            .multiplyScalar(
                                POINT_START_MARGIN
                            )
                    );
        }
    }


    const leaderGeometry =
        new LineGeometry();


    leaderGeometry.setPositions([

        leaderStart.x,
        leaderStart.y,
        leaderStart.z,

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
                groupOpacity < 1,

            opacity:
                groupOpacity,

            resolution:
                new THREE.Vector2(
                    width,
                    height
                ),

            /*
             * Always show the leader.
             */
            depthTest:
                false
        });


    const leader =
        new Line2(
            leaderGeometry,
            leaderMaterial
        );


    leader.renderOrder =
        9998;


    return leader;
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


    // --------------------------------------------------------
    // Viewport size (shared by all leader lines this pass)
    // --------------------------------------------------------

    const viewportWidth =
        getViewportWidth();


    const viewportHeight =
        getViewportHeight();


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
                            groupOpacity < 1,

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
                // Label position: nearest screen edge
                // =============================================

                labelPosition =
                    computeEdgeLabelPosition(
                        pointPosition
                    );


                // =============================================
                // Leader line
                //
                // Exactly one straight segment:
                //
                // POINT ----------------> nearest screen edge
                // =============================================

                const leader =
                    createLeaderLine(
                        pointPosition,
                        labelPosition,
                        color,
                        groupOpacity,
                        viewportWidth,
                        viewportHeight
                    );


                leader.userData.annotationId =
                    ann.id;


                state.annotationObjects.add(
                    leader
                );


                // ---------------------------------------------
                // Occlusion
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
                    ann.projectedEdges.length > 0
                ) {

                    ann.projectedEdges.forEach(
                        (
                            edge,
                            edgeIdx
                        ) => {

                            const startIdx =
                                edgeIdx === 0
                                    ? 0
                                    : 1;


                            for (
                                let j = startIdx;
                                j < edge.length;
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
                        ann.type === 'polygon' &&
                        points.length > 0
                    ) {

                        points.push(
                            points[0].clone()
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
                            groupOpacity < 1,

                        opacity:
                            groupOpacity,

                        resolution:
                            new THREE.Vector2(
                                viewportWidth,
                                viewportHeight
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
                                    groupOpacity < 1,

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
                // Label anchor: centroid for polygon,
                // first point for line
                // ---------------------------------------------

                let anchorPosition =
                    null;


                if (
                    ann.type === 'polygon' &&
                    ann.points.length > 0
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


                    anchorPosition =
                        new THREE.Vector3(

                            centroid.x /
                            ann.points.length,

                            centroid.y /
                            ann.points.length,

                            centroid.z /
                            ann.points.length
                        );

                } else if (
                    ann.points.length > 0
                ) {

                    const lp =
                        toDisplayCoords(
                            ann.points[0]
                        );


                    anchorPosition =
                        new THREE.Vector3(
                            lp.x,
                            lp.y,
                            lp.z
                        );
                }


                // ---------------------------------------------
                // Label position: nearest screen edge
                // ---------------------------------------------

                if (
                    anchorPosition
                ) {

                    labelPosition =
                        computeEdgeLabelPosition(
                            anchorPosition
                        );


                    occlusionCheckPos =
                        anchorPosition;


                    const leader =
                        createLeaderLine(
                            anchorPosition,
                            labelPosition,
                            color,
                            groupOpacity,
                            viewportWidth,
                            viewportHeight
                        );


                    leader.userData.annotationId =
                        ann.id;


                    state.annotationObjects.add(
                        leader
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
                    ann.points.length > 0
                ) {

                    const sp =
                        toDisplayCoords(
                            ann.points[0]
                        );


                    const anchorPosition =
                        new THREE.Vector3(
                            sp.x,
                            sp.y,
                            sp.z
                        );


                    labelPosition =
                        computeEdgeLabelPosition(
                            anchorPosition
                        );


                    occlusionCheckPos =
                        anchorPosition;


                    const leader =
                        createLeaderLine(
                            anchorPosition,
                            labelPosition,
                            color,
                            groupOpacity,
                            viewportWidth,
                            viewportHeight
                        );


                    leader.userData.annotationId =
                        ann.id;


                    state.annotationObjects.add(
                        leader
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


                const anchorPosition =
                    new THREE.Vector3(
                        bc.x,
                        bc.y,
                        bc.z
                    );


                labelPosition =
                    computeEdgeLabelPosition(
                        anchorPosition
                    );


                occlusionCheckPos =
                    anchorPosition;


                const leader =
                    createLeaderLine(
                        anchorPosition,
                        labelPosition,
                        color,
                        groupOpacity,
                        viewportWidth,
                        viewportHeight
                    );


                leader.userData.annotationId =
                    ann.id;


                state.annotationObjects.add(
                    leader
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
                    groupOpacity < 1
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
        ann.faceData.length === 0
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
                faceId.split('_');


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
                .get(meshIdx)
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
                                faceIdx * 3
                            );


                        b =
                            geometry.index.getX(
                                faceIdx * 3 + 1
                            );


                        c =
                            geometry.index.getX(
                                faceIdx * 3 + 2
                            );

                    } else {

                        a =
                            faceIdx * 3;


                        b =
                            faceIdx * 3 + 1;


                        c =
                            faceIdx * 3 + 2;
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
        vertices.length === 0
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
