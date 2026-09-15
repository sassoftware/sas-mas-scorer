// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Alert } from './Alert';
import { Button } from './Button';

export interface ChunkErrorBoundaryProps {
  children: React.ReactNode;
  /** Heading of the fallback alert. */
  title?: string;
  /** Body copy of the fallback alert. */
  message?: string;
}

interface ChunkErrorBoundaryState {
  hasError: boolean;
}

/**
 * Error boundary for the lazily loaded pages. A chunk that fails to load
 * (a stale index after a redeploy, a dropped connection) throws while
 * rendering, which would otherwise blank the whole app; here it becomes an
 * error alert offering an in-place retry and, failing that, a page reload.
 *
 * Wrap the routed content, not the shell, so the header and sidebar survive.
 */
export class ChunkErrorBoundary extends React.Component<
  ChunkErrorBoundaryProps,
  ChunkErrorBoundaryState
> {
  constructor(props: ChunkErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ChunkErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Unhandled error while rendering:', error, info.componentStack);
  }

  /** Re-render the children in place. Recovers a one-off render error, and a
   *  genuinely missing chunk simply throws again and brings the alert back. */
  handleRetry = () => {
    this.setState({ hasError: false });
  };

  /** Last resort. In the jobdef build the page came from SAS Job Execution,
   *  often via POST, so a reload can prompt to resubmit — offered after the
   *  in-place retry, never as the only way out. */
  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const {
      title = 'This page could not be loaded',
      message = 'Something went wrong while loading this part of the application. Try again, or reload the page.',
    } = this.props;

    return (
      <Alert
        variant="error"
        title={title}
        actions={
          <>
            <Button variant="secondary" size="small" onClick={this.handleRetry}>
              Try again
            </Button>
            <Button variant="tertiary" size="small" onClick={this.handleReload}>
              Reload
            </Button>
          </>
        }
      >
        {message}
      </Alert>
    );
  }
}

export default ChunkErrorBoundary;
