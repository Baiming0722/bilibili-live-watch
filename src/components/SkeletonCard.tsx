import React from "react";
import { motion } from "framer-motion";

const cardVariants = {
  hidden: { opacity: 0, y: 24, scale: 0.96 },
  show: { 
    opacity: 1, 
    y: 0, 
    scale: 1,
    transition: {
      type: "spring" as const,
      stiffness: 260,
      damping: 24
    }
  }
};

export function SkeletonCard() {
  return (
    <motion.article className="room-card skeleton-card" variants={cardVariants}>
      <div className="card-topline">
        <span className="skeleton-text" style={{ width: "40px" }} />
        <span className="skeleton-text" style={{ width: "80px", marginLeft: "auto" }} />
      </div>
      <div className="cover-frame skeleton-img" />
      <div className="card-body">
        <div className="skeleton-text" style={{ width: "100%", height: "20px", marginBottom: "8px" }} />
        <div className="streamer-row">
          <span className="avatar skeleton-img" />
          <span className="skeleton-text" style={{ width: "60px" }} />
        </div>
        <div className="meta-row">
          <span className="skeleton-text" style={{ width: "50px" }} />
          <span className="skeleton-text" style={{ width: "50px" }} />
        </div>
        <div className="updated-row">
          <span className="skeleton-text" style={{ width: "120px" }} />
        </div>
      </div>
      <div className="group-select-row">
        <div className="skeleton-text" style={{ width: "100%", height: "32px" }} />
      </div>
      <div className="card-actions">
        <div className="skeleton-img" style={{ flex: 1, height: "32px", borderRadius: "6px" }} />
        <div className="skeleton-img" style={{ flex: 1, height: "32px", borderRadius: "6px" }} />
        <div className="skeleton-img" style={{ flex: 1, height: "32px", borderRadius: "6px" }} />
      </div>
    </motion.article>
  );
}
