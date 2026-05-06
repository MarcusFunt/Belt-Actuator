import React from "react";

export default function DashboardPage() {
  return (
    <main className="app-shell page-shell">
      <header className="topbar">
        <div>
          <h1>Dashboard</h1>
          <p>Project tools and generators</p>
        </div>
      </header>

      <section className="dashboard-page dashboard-grid" aria-label="Projects">
        <a id="beltActuatorProject" className="project-card" href="#/belt-actuator">
          <span className="project-card-kicker">Project</span>
          <strong>Belt Actuator</strong>
          <span>
            Open the belt layout solver, export Fusion parameters, and generate pulley 3D files.
          </span>
        </a>
        <a id="tractionWheelProject" className="project-card" href="#/traction-wheel">
          <span className="project-card-kicker">Calculator</span>
          <strong>High-Traction O-Ring Wheels</strong>
          <span>
            Size an o-ring tire from wheel diameter, groove dimensions, conserved volume, and stretch.
          </span>
        </a>
      </section>
    </main>
  );
}
