import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

export default function StlPreview({ stlBuffer, label }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !stlBuffer) {
      return undefined;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xfcfcfa);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 5000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    scene.add(new THREE.HemisphereLight(0xffffff, 0xc3c9bf, 2.1));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
    keyLight.position.set(80, -100, 140);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xe6f2ee, 1.2);
    fillLight.position.set(-80, 70, 90);
    scene.add(fillLight);

    const geometry = new STLLoader().parse(stlBuffer.slice(0));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    const box = geometry.boundingBox || new THREE.Box3();
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    geometry.translate(-center.x, -center.y, -center.z);

    const material = new THREE.MeshStandardMaterial({
      color: 0xd9ded8,
      roughness: 0.45,
      metalness: 0.08
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    const axes = new THREE.AxesHelper(Math.max(size.x, size.y, size.z, 10) * 0.65);
    axes.material.depthTest = false;
    scene.add(axes);

    const maxDimension = Math.max(size.x, size.y, size.z, 10);
    camera.position.set(maxDimension * 1.25, -maxDimension * 1.65, maxDimension * 1.1);
    camera.near = Math.max(maxDimension / 1000, 0.1);
    camera.far = maxDimension * 20;
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.update();

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    let animationFrame = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      controls.dispose();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [stlBuffer]);

  return (
    <div ref={mountRef} className="viewer-frame" aria-label={label}>
      {!stlBuffer && (
        <div className="viewer-empty">
          <strong>No STL rendered</strong>
          <span>Set pulley parameters, then render to preview the generated model.</span>
        </div>
      )}
    </div>
  );
}
