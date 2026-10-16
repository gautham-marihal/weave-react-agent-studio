import React from 'react';
import '../changes/changes.css';

// What differs between two versions, as sentences grouped by what they are about. A change to a long text (the instructions, say) has a "Show the
// wording" that opens the two texts one above the other.
const MARK = { Added: '+', Removed: '−', Changed: '~' };

export default function PlainDiff({ plain }) {
  return (
    <div className="chgList cmpList">
      {plain.groups.map((group) => (
        <section key={group.key} className="chgGroup" aria-label={group.title}>
          <header>
            <h3>
              {group.title} <span className="chgCount">{group.items.length}</span>
            </h3>
          </header>
          <ul>
            {group.items.map((item, index) => (
              <li key={index} className={item.verb.toLowerCase()}>
                <span className="chgVerb cmpMark" role="img" aria-label={item.verb}>
                  {MARK[item.verb] || '~'}
                </span>
                <span className="chgText">
                  {item.text}
                  {item.full && (
                    <details className="cmpWording">
                      <summary>Show the wording</summary>
                      {item.full.before !== null && (
                        <div>
                          <small>Before</small>
                          <p>{item.full.before}</p>
                        </div>
                      )}
                      {item.full.after !== null && (
                        <div>
                          <small>After</small>
                          <p>{item.full.after}</p>
                        </div>
                      )}
                    </details>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
