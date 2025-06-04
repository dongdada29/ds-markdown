import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

import HighReactMarkdown from '../components/HighReactMarkdown/index';
import classNames from 'classnames';
import { AnswerType, IParagraph, MarkdownProps } from '../defined.js';
import { compiler } from '../utils/compiler.js';
import { __DEV__ } from '../constant.js';

type MarkdownCMDProps = MarkdownProps;

interface IChar {
  content: string;
  answerType: AnswerType;
  contentType: 'space' | 'segment';
}

export interface MarkdownRef {
  push: (content: string, answerType: AnswerType) => void;
  clear: () => void;
  triggerWholeEnd: () => void;
}
const MarkdownCMD = forwardRef<MarkdownRef, MarkdownCMDProps>(({ interval = 30, isClosePrettyTyped = false, onEnd, onStart, onTypedChar }, ref) => {
  /** 当前需要打字的内容 */
  const charsRef = useRef<IChar[]>([]);

  /**
   * 打字是否已经完全结束
   * 如果打字已经完全结束，则不会再触发打字效果
   */
  const isWholeTypedEndRef = useRef(false);

  /** 已经打过的字 */
  const typedCharsRef = useRef<{ typedContent: string; answerType: AnswerType; prevStr: string } | undefined>(undefined);
  /** 是否卸载 */
  const isUnmountRef = useRef(false);
  /** 是否正在打字 */
  const isTypedRef = useRef(false);

  /** 打字结束回调, */
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  /** 打字开始回调 */
  const onStartRef = useRef(onStart);
  onStartRef.current = onStart;
  /** 打字过程中回调 */
  const onTypedCharRef = useRef(onTypedChar);
  onTypedCharRef.current = onTypedChar;

  /** 打字定时器 */
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  /**
   * 稳定段落
   * 稳定段落是已经打过字，并且不会再变化的段落
   */
  const [stableSegments, setStableSegments] = useState<IParagraph[]>([]);
  /** 当前段落 */
  const [currentSegment, setCurrentSegment] = useState<IParagraph | undefined>(undefined);
  /** 当前段落引用 */
  const currentParagraphRef = useRef<IParagraph | undefined>(undefined);
  currentParagraphRef.current = currentSegment;

  /** 清除打字定时器 */
  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    isTypedRef.current = false;
  };

  useEffect(() => {
    isUnmountRef.current = false;
    return () => {
      isUnmountRef.current = true;
    };
  }, []);

  /** 思考段落 */
  const thinkingParagraphs = useMemo(() => stableSegments.filter((paragraph) => paragraph.answerType === 'thinking'), [stableSegments]);
  /** 回答段落 */
  const answerParagraphs = useMemo(() => stableSegments.filter((paragraph) => paragraph.answerType === 'answer'), [stableSegments]);

  /**
   * 记录打过的字
   * @param char 当前字符
   * @returns
   */
  const recordTypedChars = (char: IChar) => {
    let prevStr = '';
    if (!typedCharsRef.current || typedCharsRef.current.answerType !== char.answerType) {
      typedCharsRef.current = {
        typedContent: char.content,
        answerType: char.answerType,
        prevStr: '',
      };
    } else {
      prevStr = typedCharsRef.current.typedContent;
      typedCharsRef.current.typedContent += char.content;
      typedCharsRef.current.prevStr = prevStr;
    }

    return {
      prevStr,
      nextStr: typedCharsRef.current?.typedContent || '',
    };
  };

  /**
   * 触发打字开始回调
   * @param char 当前字符
   */
  const triggerOnStart = (char: IChar) => {
    const onStartFn = onStartRef.current;
    if (!onStartFn) {
      return;
    }
    const { prevStr } = recordTypedChars(char);
    onStartRef.current?.({
      currentIndex: prevStr.length,
      currentChar: char.content,
      answerType: char.answerType,
      prevStr,
    });
  };

  /**
   * 触发打字结束回调
   */
  const triggerOnEnd = () => {
    const onEndFn = onEndRef.current;
    if (!onEndFn) {
      return;
    }

    onEndFn({
      str: typedCharsRef.current?.typedContent,
      answerType: typedCharsRef.current?.answerType,
    });
  };

  /**
   * 触发打字过程中回调
   * @param char 当前字符
   * @param isStartPoint 是否是开始打字(第一个字)
   */
  const triggerOnTypedChar = (char: IChar, isStartPoint = false) => {
    const onTypedCharFn = onTypedCharRef.current;
    if (!isStartPoint) {
      recordTypedChars(char);
    }
    if (!onTypedCharFn) {
      return;
    }

    onTypedCharFn({
      currentIndex: typedCharsRef.current?.prevStr.length || 0,
      currentChar: char.content,
      answerType: char.answerType,
      prevStr: typedCharsRef.current?.prevStr || '',
    });
  };

  /** 开始打字任务 */
  const startTypedTask = () => {
    if (isTypedRef.current) {
      return;
    }

    const chars = charsRef.current;

    /** 停止打字 */
    const stopTyped = () => {
      isTypedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      triggerOnEnd();
    };

    /** 打下一个字 */
    const nextTyped = () => {
      if (chars.length === 0) {
        stopTyped();
        return;
      }
      timerRef.current = setTimeout(startTyped, interval);
    };

    /**
     * 开始打字
     * @param isStartPoint 是否是开始打字
     */
    function startTyped(isStartPoint = false) {
      if (isUnmountRef.current) {
        return;
      }
      isTypedRef.current = true;

      const char = chars.shift();
      if (char === undefined) {
        stopTyped();
        return;
      }

      if (isStartPoint) {
        triggerOnStart(char);
        triggerOnTypedChar(char, isStartPoint);
      } else {
        triggerOnTypedChar(char);
      }

      const currentSegment = currentParagraphRef.current;
      /** 如果碰到 space 则需要处理成两个段落 */
      if (char.contentType === 'space') {
        if (currentSegment) {
          setStableSegments((prev) => {
            const newParagraphs = [...prev];
            if (currentSegment) {
              newParagraphs.push({ ...currentSegment, isTyped: false });
            }
            newParagraphs.push({
              content: '',
              isTyped: false,
              type: 'br',
              answerType: char.answerType,
            });
            return newParagraphs;
          });
          setCurrentSegment(undefined);
        } else {
          setStableSegments((prev) => {
            const newParagraphs = [...prev];
            newParagraphs.push({
              content: '',
              isTyped: false,
              type: 'br',
              answerType: char.answerType,
            });
            return newParagraphs;
          });
        }
        nextTyped();
        return;
      }

      // 处理当前段落
      let _currentParagraph = currentSegment;
      const newCurrentParagraph: IParagraph = {
        content: '',
        isTyped: false,
        type: 'text',
        answerType: char.answerType,
      };

      if (!_currentParagraph) {
        // 如果当前没有段落，则直接设置为当前段落
        _currentParagraph = newCurrentParagraph;
      } else if (currentSegment && currentSegment?.answerType !== char.answerType) {
        // 如果当前段落和当前字符的回答类型不一致，则需要处理成两个段落
        setStableSegments((prev) => {
          const newParagraphs = [...prev];
          newParagraphs.push({ ...currentSegment, isTyped: false });
          return newParagraphs;
        });
        _currentParagraph = newCurrentParagraph;
        setCurrentSegment(_currentParagraph);
      }

      setCurrentSegment((prev) => {
        return {
          ..._currentParagraph,
          content: (prev?.content || '') + char.content,
          isTyped: true,
        };
      });

      nextTyped();
    }

    startTyped(true);
  };

  const lastSegmentRaw = useRef('');

  useImperativeHandle(ref, () => ({
    /**
     * 添加内容
     * @param content 内容 {string}
     * @param answerType 回答类型 {AnswerType}
     */
    push: (content: string, answerType: AnswerType) => {
      if (isWholeTypedEndRef.current) {
        if (__DEV__) {
          console.warn('打字已经完全结束，不能再添加新的内容');
        }
        return;
      }
      if (!lastSegmentRaw.current) {
        lastSegmentRaw.current = content;
      } else {
        lastSegmentRaw.current += content;
      }

      const tokens = compiler(lastSegmentRaw.current);

      // 如果最后一个token是segment，则把最后一个token的raw赋值给lastSegmentRaw
      if (tokens[tokens.length - 1].type === 'segment') {
        lastSegmentRaw.current = tokens[tokens.length - 1].raw;
      } else {
        lastSegmentRaw.current = '';
      }

      tokens.forEach((token) => {
        if (token.type === 'space') {
          charsRef.current.push({ content: token.raw, answerType, contentType: 'space' });
        } else {
          charsRef.current.push(...(token.raw.split('').map((char) => ({ content: char, answerType, contentType: 'segment' })) as IChar[]));
        }
      });

      if (!isTypedRef.current) {
        startTypedTask();
      }
    },
    /**
     * 清除打字任务
     */
    clear: () => {
      clearTimer();
      charsRef.current = [];
      setStableSegments([]);
      setCurrentSegment(undefined);
      isWholeTypedEndRef.current = false;
    },
    /**
     * 主动触发打字结束
     */
    triggerWholeEnd: () => {
      isWholeTypedEndRef.current = true;
      if (!isTypedRef.current) {
        triggerOnEnd();
      }
    },
  }));

  const getParagraphs = (paragraphs: IParagraph[], answerType: AnswerType) => {
    return (
      <div className={`ds-markdown-paragraph ds-typed-${answerType}`}>
        {paragraphs.map((paragraph, index) => {
          if (paragraph.type === 'br') {
            return null;
          }
          return <HighReactMarkdown key={index}>{paragraph.content || ''}</HighReactMarkdown>;
        })}
        {currentSegment?.answerType === answerType && <HighReactMarkdown key={currentSegment.content}>{currentSegment.content || ''}</HighReactMarkdown>}
      </div>
    );
  };

  return (
    <div
      className={classNames({
        'ds-markdown': true,
        apple: true,
      })}
    >
      {(thinkingParagraphs.length > 0 || currentSegment?.answerType === 'thinking') && <div className="ds-markdown-thinking">{getParagraphs(thinkingParagraphs, 'thinking')}</div>}
      {(answerParagraphs.length > 0 || currentSegment?.answerType === 'answer') && <div className="ds-markdown-answer">{getParagraphs(answerParagraphs, 'answer')}</div>}
    </div>
  );
});

export default MarkdownCMD;
