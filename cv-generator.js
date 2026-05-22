// cv-generator.js — Shared PDF generation module
// Loaded in: popup.html (via <script>), content-script context (injected before content-simple.js)
// Depends on: window.jspdf (from vendor/jspdf.umd.min.js)

(function () {
  'use strict';

  // Idempotent guard — safe to inject multiple times
  if (window.AutoApplyMax && window.AutoApplyMax.generateCVPdf) return;

  window.AutoApplyMax = window.AutoApplyMax || {};

  // ── FNV-1a 32-bit hash (same algorithm as background.js cacheKey) ──────────
  function hashJobDesc(text) {
    let h = 0x811c9dc5;
    const norm = (text || '').toLowerCase().trim();
    for (let i = 0; i < norm.length; i++) {
      h ^= norm.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return 'cv_' + h.toString(16);
  }

  // ── Generate jsPDF document from structured CV JSON + profile ───────────────
  function generateCVPdf(cvJson, profile) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });

    const pageW = 210;
    const margin = 18;
    const contentW = pageW - margin * 2;
    let y = 20;

    function rgb(r, g, b) { doc.setTextColor(r, g, b); }
    function drawLine() {
      doc.setDrawColor(200, 200, 200);
      doc.line(margin, y, pageW - margin, y);
      y += 5;
    }

    // ── Header: Name ─────────────────────────────────────────────────────────
    const name = ((profile.firstName || '') + ' ' + (profile.lastName || '')).trim() || 'Candidate';
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    rgb(30, 30, 30);
    doc.text(name, margin, y);
    y += 7;

    // Contact line
    const contactParts = [profile.email, profile.phone, profile.city].filter(Boolean);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    rgb(100, 100, 100);
    if (contactParts.length) {
      doc.text(contactParts.join('  •  '), margin, y);
      y += 5;
    }

    // GitHub URL
    if (cvJson.githubUrl) {
      doc.setFontSize(9);
      rgb(10, 102, 194);
      doc.textWithLink(cvJson.githubUrl, margin, y, { url: cvJson.githubUrl });
      y += 5;
    }

    drawLine();

    // ── Professional Summary ──────────────────────────────────────────────────
    if (cvJson.summary) {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      rgb(30, 30, 30);
      doc.text('Professional Summary', margin, y);
      y += 5;

      doc.setFontSize(9.5);
      doc.setFont('helvetica', 'italic');
      rgb(50, 50, 50);
      const summaryLines = doc.splitTextToSize(cvJson.summary, contentW);
      doc.text(summaryLines, margin, y);
      y += summaryLines.length * 5 + 4;
    }

    // ── Technical Skills ──────────────────────────────────────────────────────
    if (cvJson.skills && cvJson.skills.length > 0) {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      rgb(30, 30, 30);
      doc.text('Technical Skills', margin, y);
      y += 5;

      doc.setFontSize(9.5);
      doc.setFont('helvetica', 'normal');
      rgb(50, 50, 50);
      const skillText = cvJson.skills.join('  ·  ');
      const skillLines = doc.splitTextToSize(skillText, contentW);
      doc.text(skillLines, margin, y);
      y += skillLines.length * 5 + 4;
    }

    // ── Project Experience ────────────────────────────────────────────────────
    if (cvJson.projects && cvJson.projects.length > 0) {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      rgb(30, 30, 30);
      doc.text('Project Experience', margin, y);
      y += 6;

      for (const proj of cvJson.projects.slice(0, 5)) {
        if (y > 265) break; // page overflow guard

        // Project name (linked if URL provided)
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        rgb(10, 102, 194);
        if (proj.url) {
          doc.textWithLink(proj.name || 'Project', margin, y, { url: proj.url });
        } else {
          doc.text(proj.name || 'Project', margin, y);
        }

        // Tech stack inline after name
        if (proj.technologies && proj.technologies.length > 0) {
          const nameW = doc.getTextWidth(proj.name || 'Project') + 4;
          doc.setFontSize(8.5);
          doc.setFont('helvetica', 'italic');
          rgb(100, 100, 100);
          doc.text(proj.technologies.join(', '), margin + nameW, y);
        }
        y += 5;

        // Description
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        rgb(50, 50, 50);
        const descLines = doc.splitTextToSize(proj.description || '', contentW);
        doc.text(descLines, margin + 3, y);
        y += descLines.length * 4.5 + 5;
      }
    }

    return doc;
  }

  // ── Returns base64 string (no data-URI prefix) ────────────────────────────
  function cvToBase64(cvJson, profile) {
    const doc = generateCVPdf(cvJson, profile);
    return doc.output('datauristring').split(',')[1];
  }

  window.AutoApplyMax.generateCVPdf = generateCVPdf;
  window.AutoApplyMax.cvToBase64    = cvToBase64;
  window.AutoApplyMax.hashJobDesc   = hashJobDesc;
})();
