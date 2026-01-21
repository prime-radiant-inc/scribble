import { metrics as otelMetrics } from '@opentelemetry/api';

const meter = otelMetrics.getMeter('scribble');

// Message processing metrics
export const messagesProcessed = meter.createCounter('scribble_messages_processed_total', {
  description: 'Total number of messages processed',
});

export const messageProcessingDuration = meter.createHistogram('scribble_message_processing_duration_seconds', {
  description: 'Time spent processing messages',
  unit: 'seconds',
});

// Tool execution metrics
export const toolExecutions = meter.createCounter('scribble_tool_executions_total', {
  description: 'Total number of tool executions',
});

export const toolExecutionDuration = meter.createHistogram('scribble_tool_execution_duration_seconds', {
  description: 'Time spent executing tools',
  unit: 'seconds',
});

// API call metrics
export const apiCalls = meter.createCounter('scribble_api_calls_total', {
  description: 'Total number of API calls to Claude',
});

export const apiCallDuration = meter.createHistogram('scribble_api_call_duration_seconds', {
  description: 'Time spent on API calls',
  unit: 'seconds',
});

export const apiErrors = meter.createCounter('scribble_api_errors_total', {
  description: 'Total number of API errors',
});

// Thread engagement metrics
export const threadEngagements = meter.createCounter('scribble_thread_engagements_total', {
  description: 'Total number of thread engagements',
});

// Wiki operation metrics
export const wikiOperations = meter.createCounter('scribble_wiki_operations_total', {
  description: 'Total number of wiki operations',
});

// Learning metrics
export const behaviorsLearned = meter.createCounter('scribble_behaviors_learned_total', {
  description: 'Total number of behaviors learned',
});

export const channelInstructionsSet = meter.createCounter('scribble_channel_instructions_set_total', {
  description: 'Total number of channel instructions set',
});

export const metrics = {
  messagesProcessed,
  messageProcessingDuration,
  toolExecutions,
  toolExecutionDuration,
  apiCalls,
  apiCallDuration,
  apiErrors,
  threadEngagements,
  wikiOperations,
  behaviorsLearned,
  channelInstructionsSet,
};
