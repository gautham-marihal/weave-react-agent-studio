import React from 'react';
import { Modal } from '../ui.jsx';
import './changes.css';

// "What have I changed?": the draft against the newest published version, by part, each with a way back.
export default function ChangesPanel({ changes, version, onRevert, onClose }) {
  return (
    <Modal
      wide
      eyebrow="Compared with the published version"
      title={changes.total === 0 ? `Same as v${version}` : `${changes.total} change${changes.total === 1 ? '' : 's'} since v${version}`}
      subtitle={
        changes.total === 0
          ? 'The draft has nothing the published version does not.'
          : 'Nothing here is live until you publish and deploy it. You can put any part back as it was published.'
      }
      onClose={onClose}
      footer={
        <button type="button" className="modalCancel" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="chgList">
        {changes.groups.map((group) => (
          <section key={group.key} className="chgGroup" aria-label={group.section}>
            <header>
              <h3>
                {group.section} <span className="chgCount">{group.items.length}</span>
              </h3>
              <button type="button" className="quietButton small" onClick={() => onRevert(group.key, group.section)}>
                Put back as published
              </button>
            </header>
            <ul>
              {group.items.map((item, index) => (
                <li key={index} className={item.verb.toLowerCase()}>
                  <span className="chgVerb">{item.verb}</span>
                  <span className="chgText">
                    {item.text}
                    {item.detail ? <small>{item.detail}</small> : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
