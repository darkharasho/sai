import React from 'react';
import { stories } from './stories';

export function TestHarness() {
  const params = new URLSearchParams(window.location.search);
  const storyName = params.get('story');
  const story = storyName ? stories[storyName] : null;

  if (!story) {
    return (
      <div style={{ padding: 20, fontFamily: 'monospace', color: '#fff', background: '#111' }}>
        <h2>Test Harness</h2>
        <p>Available stories:</p>
        <ul>
          {Object.keys(stories).map(name => (
            <li key={name}>
              <a href={`/test-harness?story=${name}`} style={{ color: '#7cf' }}>{name}</a>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const props = story.parseProps(params);
  const Component = story.component;

  return (
    <div
      data-testid="harness-root"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: '#1a1a1a',
      }}
    >
      <Component {...props} />
    </div>
  );
}
