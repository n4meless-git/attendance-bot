require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

// 🕒 한국 시간(KST)을 안전하게 구하는 헬퍼 함수
function getKSTInfo() {
    const now = new Date();
    const todayStr = now.toLocaleDateString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).replace(/\. /g, '-').replace('.', '');

    const hourStr = now.toLocaleTimeString('ko-KR', {
        timeZone: 'Asia/Seoul',
        hour: '2-digit',
        hour12: false
    });
    const currentHour = parseInt(hourStr, 10);

    return { today: todayStr, currentHour, nativeDate: now };
}

function getRemindMessage(hour) {
    if (hour === 11) return "좋은 아침이에요! 오늘도 잊지 말고 출근 도장 꾹 눌러주세요? ✨";
    if (hour === 14) return "벌써 오후 2시에요! 설마 오늘 출근 까먹으신 건 아니죠...? 얼른 오세요! 🤨";
    if (hour === 17) return "이제 해가 지려고 해요... 오늘 출근 안 하시면 연속 기록이 깨질지도 몰라요. 제발 와주세요. 😭";
    if (hour === 18) return "저기요... 아직도 안 오신 건가요? 6시예요. 이제 슬슬 걱정되기 시작하네요. 😟";
    if (hour === 19) return "7시입니다. 당신의 연속 출근 기록이 공중분해 되기 직전이에요. 지금 당장 오세요! ⚡";
    if (hour === 20) return "8시... 이제 제 목소리가 들리지 않나요? 당신의 성실함이 시험받고 있어요. ✊";
    if (hour === 21) return "9시예요. 이대로 포기하실 건가요? 지금까지 쌓아온 노력이 아깝지 않으세요? 😠";
    if (hour === 22) return "10시입니다. 이제 시간이 얼마 없어요. 제발... 마지막 기회일지도 몰라요. 🙏";
    if (hour === 23) return "11시!!! 이제 한 시간 뒤면 모든 게 끝납니다. 죽기 살기로 출근하세요! 빨리!!! 🚨🚨";
    return null;
}

// 🛡️ 재원이 대리 출근 공통 핵심 로직
async function runJaewonAttendance() {
    const { today } = getKSTInfo();
    
    const JAEWON_ID = "1152202483666538516";
    const JAEWON_NAME = "smphur08";

    const { data: user, error: selectError } = await supabase
        .from('attendance')
        .select('*')
        .eq('user_id', JAEWON_ID)
        .maybeSingle();

    if (selectError) throw selectError;

    if (user && user.last_checkin === today) {
        return { success: false, status: "ALREADY", reason: "이미 오늘 출근 처리가 되어 있습니다.", streak: user.streak };
    }

    let currentTokens = user ? (user.tokens ?? 200) : 200;
    if (currentTokens < 10) {
        return { success: false, status: "NO_TOKEN", reason: "보유 토큰이 부족합니다. (대리 출근에는 10 토큰이 필요합니다.)", streak: user ? user.streak : 0 };
    }

    currentTokens -= 10;

    let newStreak = 1;
    if (user && user.last_checkin) {
        const formatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
        const parts = formatter.formatToParts(new Date());
        const y = parts.find(p => p.type === 'year').value;
        const m = parts.find(p => p.type === 'month').value;
        const d = parts.find(p => p.type === 'day').value;
        
        const yesterday = new Date(`${y}-${m}-${d}T12:00:00+09:00`);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        if (user.last_checkin === yesterdayStr) {
            newStreak = (user.streak || 0) + 1;
        }
    }

    const currentCards = user ? (user.protection_cards ?? 0) : 0;

    await supabase.from('attendance').upsert({
        user_id: JAEWON_ID,
        username: JAEWON_NAME,
        last_checkin: today,
        streak: newStreak,
        tokens: currentTokens,
        protection_cards: currentCards
    }, { onConflict: 'user_id' });

    return { success: true, streak: newStreak, remainingTokens: currentTokens };
}

client.once('ready', () => {
    console.log(`✅ 봇 로그인 성공: ${client.user.tag}`);

    // ⏰ 재원이 자동 대리 출근 스케줄러 (한국 시간 밤 11시 정각 고정)
    cron.schedule('0 23 * * *', async () => {
        try {
            const result = await runJaewonAttendance();
            if (result.success) {
                console.log(`✨ [자동완료] 한국 시간 23시 대리 출근 성공! (연속 ${result.streak}일째 | 남은 토큰: ${result.remainingTokens})`);
            } else {
                console.log(`[재원봇] 23시 대리 출근 스킵: ${result.reason}`);
            }
        } catch (err) {
            console.error("❌ 재원이 대리 출근 스케줄러 작동 실패:", err);
        }
    }, {
        timezone: "Asia/Seoul"
    });

    // 정각 알림 스케줄러 (한국 시간 매 정각)
    cron.schedule('0 * * * *', async () => {
        const { today, currentHour } = getKSTInfo();
        const messageText = getRemindMessage(currentHour);
        
        if (messageText) {
            const { data: allUsers } = await supabase.from('attendance').select('*');
            if (allUsers) {
                for (const user of allUsers) {
                    if (user.last_checkin !== today) {
                        try {
                            const discordUser = await client.users.fetch(user.user_id);
                            await discordUser.send(`🔔 <@${user.user_id}>님! ${messageText}`);
                        } catch (err) { console.error(`${user.username} DM 전송 실패`); }
                    }
                }
            }
        }
    }, {
        timezone: "Asia/Seoul"
    });

    // 매일 밤 23시 59분 자동 방어 및 리셋 스케줄러 (한국 시간 기준)
    cron.schedule('59 23 * * *', async () => {
        const { today } = getKSTInfo();

        const { data: allUsers } = await supabase.from('attendance').select('*');
        if (!allUsers) return;

        for (const user of allUsers) {
            if (user.last_checkin !== today && (user.streak || 0) > 0) {
                let cards = user.protection_cards || 0;
                
                if (cards > 0) {
                    cards -= 1;
                    await supabase
                        .from('attendance')
                        .update({ protection_cards: cards })
                        .eq('user_id', user.user_id);
                    
                    try {
                        const discordUser = await client.users.fetch(user.user_id);
                        await discordUser.send(`🛡️ 오늘 출근하지 않았지만, **출근 횟수 보호권**이 사용되어 연속 출근 기록이 유지되었습니다! (남은 보호권: ${cards}개)`);
                    } catch (e) {}
                } else {
                    await supabase
                        .from('attendance')
                        .update({ streak: 0 })
                        .eq('user_id', user.user_id);

                    try {
                        const discordUser = await client.users.fetch(user.user_id);
                        await discordUser.send(`💀 보호권이 없어 오늘 자로 연속 출근 횟수가 초기화되었습니다. 내일부터 다시 힘내세요!`);
                    } catch (e) {}
                }
            }
        }
    }, {
        timezone: "Asia/Seoul"
    });
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const userId = message.author.id;
    const { today, currentHour } = getKSTInfo();

    // 🧪 재원이 대리 출근 수동 테스트 명령어
    if (message.content === "!재원") {
        try {
            await message.channel.sendTyping();
            const result = await runJaewonAttendance();
            
            if (result.success) {
                return message.reply(`🎯 **[수동 완료]** 재원이 대리 출근 처리에 성공했습니다!\n💰 수수료로 **10 토큰**이 차감되었습니다. (잔여: 💰 \`${result.remainingTokens} 토큰\`)\n🔥 현재 연속 **${result.streak}일째** 출근 중입니다.`);
            } else {
                return message.reply(`ℹ️ **[스킵 알림]** 재원이는 ${result.reason} (현재 스트릭: \`${result.streak}일\`)`);
            }
        } catch (err) {
            console.error(err);
            return message.reply("❌ **[오류 발생]** 재원이 DB 처리 중 문제가 발생했습니다.");
        }
    }

    // 듀오링고 테스트 로직
    if (message.content === "듀오링고") {
        const testMsg = getRemindMessage(currentHour);
        const finalMsg = testMsg ? testMsg : `현재 한국 시간 ${currentHour}시입니다. (정기 알림 대기 중)`;

        try {
            await message.author.send(`🧪 **[테스트 알림]**\n🔔 <@${userId}>님! ${finalMsg}`);
            return message.reply("성공! 개인 DM을 확인해보세요. 📩");
        } catch (err) {
            return message.reply("DM 전송에 실패했습니다. 설정을 확인해 보세요!");
        }
    }

    // 토큰 상점 로직 (!상점)
    if (message.content === "!상점") {
        try {
            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            const myTokens = user ? (user.tokens ?? 200) : 200;
            const myCards = user ? (user.protection_cards ?? 0) : 0;

            return message.reply(`🛒 **토큰 상점에 오신 것을 환영합니다!**\n\n` +
                                `👤 **내 정보**\n` +
                                `└ 보유 토큰: 💰 \`${myTokens} 토큰\`\n` +
                                `└ 보유 보호권: 🛡️ \`${myCards} 개\`\n\n` +
                                `📦 **판매 상품**\n` +
                                `└ 🛡️ **출근 횟수 보호권** | 가격: \`100 토큰\`\n` +
                                `   *하루 결근 시 자동으로 사용되어 연속 출근 기록을 지켜줍니다.*\n\n` +
                                `👉 **명령어 안내**\n` +
                                `└ 구매: \`!구매\`\n` +
                                `└ 환불: \`!환불\` (⚠️ 구매가 20% 수수료 **80 토큰** 환불)`);
        } catch (err) {
            return message.reply("상점을 불러오는 중 오류가 발생했습니다.");
        }
    }

    // 보호권 구매 로직 (!구매)
    if (message.content === "!구매") {
        try {
            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            
            let currentTokens = user ? (user.tokens ?? 200) : 200;
            let currentCards = user ? (user.protection_cards ?? 0) : 0;
            let currentStreak = user ? (user.streak ?? 0) : 0;
            let lastCheckin = user ? user.last_checkin : null;

            if (currentTokens < 100) {
                return message.reply(`❌ 토큰이 부족합니다! (현재 보유: 💰 \`${currentTokens} 토큰\`)`);
            }

            currentTokens -= 100;
            currentCards += 1;

            await supabase.from('attendance').upsert({
                user_id: userId,
                username: message.author.username,
                tokens: currentTokens,
                protection_cards: currentCards,
                streak: currentStreak,
                last_checkin: lastCheckin
            }, { onConflict: 'user_id' });

            return message.reply(`🛒 구매 완료! **출근 횟수 보호권** 1개를 획득했습니다. (잔여 토큰: 💰 \`${currentTokens}\` | 보유 보호권: 🛡️ \`${currentCards}개\`)`);
        } catch (err) {
            console.error(err);
            return message.reply("구매 처리 중 오류가 발생했습니다.");
        }
    }

    // 보호권 환불 로직 (!환불)
    if (message.content === "!환불") {
        try {
            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            
            let currentTokens = user ? (user.tokens ?? 200) : 200;
            let currentCards = user ? (user.protection_cards ?? 0) : 0;
            let currentStreak = user ? (user.streak ?? 0) : 0;
            let lastCheckin = user ? user.last_checkin : null;

            if (currentCards < 1) {
                return message.reply(`❌ 환불할 **출근 횟수 보호권**이 없습니다!`);
            }

            currentTokens += 80;
            currentCards -= 1;

            await supabase.from('attendance').upsert({
                user_id: userId,
                username: message.author.username,
                tokens: currentTokens,
                protection_cards: currentCards,
                streak: currentStreak,
                last_checkin: lastCheckin
            }, { onConflict: 'user_id' });

            return message.reply(`💸 환불 완료! 수수료 20%를 제외한 **80 토큰**이 반환되었습니다. (현재 보유: 💰 \`${currentTokens} 토큰\` | 보유 보호권: 🛡️ \`${currentCards}개\`)`);
        } catch (err) {
            console.error(err);
            return message.reply("환불 처리 중 오류가 발생했습니다.");
        }
    }

    // ==========================================
    // 🎰 추가 기능 1: 슬롯머신 (!도박 / !슬롯) 
    // ==========================================
    if (message.content === '!도박' || message.content === '!슬롯') {
        try {
            const slotPrice = 25; // 판돈 25토큰 고정

            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            let currentTokens = user ? (user.tokens ?? 200) : 200;
            let currentCards = user ? (user.protection_cards ?? 0) : 0;
            let currentStreak = user ? (user.streak ?? 0) : 0;
            let lastCheckin = user ? user.last_checkin : null;

            if (currentTokens < slotPrice) {
                return message.reply(`❌ 토큰이 부족합니다! 슬롯머신은 **${slotPrice} 토큰**이 필요합니다. (현재 잔액: ${currentTokens} 토큰)`);
            }

            // 🎯 기본 7가지 기호 배열
            const emojis = ['7️⃣', '💎', '🍀', '🍇', '🍊', '🍒', '🔔'];
            
            // 😈 [확률 분기 재설계] 6은 0.5% 독립 확률, 4는 4.0% 독립 확률 가로채기 적용
            const generateSlotSlot = () => {
                const rand = Math.random();
                if (rand < 0.005) return '6️⃣';      // 0.5% 확률로 6 지정
                if (rand < 0.045) return '4️⃣';      // 그 뒤 4.0% 확률로 4 지정 (0.005 ~ 0.045 구간)
                return emojis[Math.floor(Math.random() * emojis.length)];
            };

            const slot1 = generateSlotSlot();
            const slot2 = generateSlotSlot();
            const slot3 = generateSlotSlot();

            let prize = 0;
            let curseType = null; 
            let resultText = '';

            // 1단계: 💀 6️⃣6️⃣6️⃣ 대재앙 판정 (800만분의 1)
            if (slot1 === '6️⃣' && slot2 === '6️⃣' && slot3 === '6️⃣') {
                curseType = '666';
                resultText = '💀☠️ **[대재앙] 6 6 6 지옥의 문이 열렸습니다!!! 영혼과 함께 1500토큰이 증발합니다!!!** ☠️💀';
            }
            // 2단계: 👁️ 4️⃣4️⃣4️⃣ 죽음의 저주 판정 (15,625분의 1 - 콘셉트 매칭형 저주)
            else if (slot1 === '4️⃣' && slot2 === '4️⃣' && slot3 === '4️⃣') {
                curseType = '444';
                resultText = '👁️🚨 **[경고] 4 4 4 사(死)의 저주가 내렸습니다! 불길한 기운과 함께 444.4토큰이 소멸합니다!** 🚨👁️';
            }
            // 3단계: 기존 3개 일치 (최상위 잭팟) 판정
            else if (slot1 === slot2 && slot2 === slot3) {
                if (slot1 === '7️⃣') {
                    prize = 1000;
                    resultText = '🔥 **[신화] 777 대박 잭팟!!! 대륙이 진동합니다! (1000토큰 획득)** 🔥';
                } else if (slot1 === '💎') {
                    prize = 600;
                    resultText = '💎 **[전설] 다이아몬드 잭팟!!! 서버의 지배자! (600토큰 획득)** 💎';
                } else if (slot1 === '🍀') {
                    prize = 300;
                    resultText = '🍀 **[에픽] 네잎클로버 잭팟!!! 신이 내린 행운! (300토큰 획득)** 🍀';
                } else {
                    prize = 75;
                    resultText = `🎰 **[일반] 잭팟! [ ${slot1} ] 3개가 일치합니다! (75토큰 획득)** 🎰`;
                }
            } 
            // 4단계: 특수 변칙 조건 1 - 네잎클로버가 양 옆에만 있는 경우 [ 🍀 | !🍀 | 🍀 ]
            else if (slot1 === '🍀' && slot3 === '🍀' && slot2 !== '🍀') {
                prize = 150;
                resultText = '🍀✨ **[시크릿] 클로버 더블 윙! 양 옆에 대박 행운이 깃듭니다! (150토큰 획득)** ✨🍀';
            }
            // 5단계: 특수 변칙 조건 2 - 다이아몬드가 2개 일치하는 경우
            else if (
                (slot1 === '💎' && slot2 === '💎') || 
                (slot2 === '💎' && slot3 === '💎') || 
                (slot1 === '💎' && slot3 === '💎')
            ) {
                prize = 100;
                resultText = '💎✨ **[더블 💎] 다이아몬드가 2개! 엄청난 자산 가치입니다! (100토큰 획득)** ✨💎';
            }
            // 6단계: 일반 2개 일치 판정 (저주 기호 6 또는 4가 하나라도 섞인 경우 당첨 예외 처리)
            else if ((slot1 === slot2 || slot2 === slot3 || slot1 === slot3) && 
                     slot1 !== '6️⃣' && slot2 !== '6️⃣' && slot3 !== '6️⃣' &&
                     slot1 !== '4️⃣' && slot2 !== '4️⃣' && slot3 !== '4️⃣') {
                prize = 15;
                resultText = '🎉 **축하합니다! 그림 2개가 일치합니다! (15토큰 획득)** 🎉';
            } 
            // 7단계: 낙첨
            else {
                prize = 0;
                resultText = '😭 **아쉽게도 낙첨되었습니다. 다음 기회에!** 😭';
            }

            // 💸 최종 토큰 정산 계산 (소수점 자산 정상 연산을 위해 Number 처리 및 고정)
            let finalTokens = currentTokens - slotPrice + prize;
            let displayPrizeText = `[ +${prize} 토큰 ]`;

            // 😈 저주 종류에 따른 차감 및 파산 방어선 처리
            if (curseType === '666') {
                finalTokens = currentTokens - slotPrice - 1500;
                displayPrizeText = `[ -1500 토큰 (666 지옥의 낙인) ]`;
            } else if (curseType === '444') {
                finalTokens = currentTokens - slotPrice - 444.4;
                displayPrizeText = `[ -444.4 토큰 (444 사의 저주) ]`;
            }

            if (finalTokens < 0) finalTokens = 0; // 마이너스 자산 방지
            
            // 소수점 둘째 자리까지 깔끔하게 반올림 처리해서 데이터 무결성 확보
            finalTokens = Math.round(finalTokens * 100) / 100;

            await supabase.from('attendance').upsert({
                user_id: userId,
                username: message.author.username,
                tokens: finalTokens,
                protection_cards: currentCards,
                streak: currentStreak,
                last_checkin: lastCheckin
            }, { onConflict: 'user_id' });

            return message.reply(
                `🎰 **SLOT MACHINE** 🎰\n` +
                `[ ${slot1} | ${slot2} | ${slot3} ]\n` +
                `-------------------------\n` +
                `${resultText}\n` +
                `💰 **정산:** 상금 ${displayPrizeText} / 판돈 [ -${slotPrice} 토큰 ]\n` +
                `💳 **현재 잔액:** ${finalTokens} 토큰`
            );
        } catch (err) {
            console.error(err);
            return message.reply("슬롯머신 구동 중 시스템 오류가 발생했습니다.");
        }
    }

    // ==========================================
    // 🎫 추가 기능 2: 로또 (!로또 수동/자동)
    // ==========================================
    if (message.content.startsWith('!로또')) {
        try {
            const args = message.content.split(' ').slice(1);
            const isAuto = (args[0] === '자동' || args.length === 0);
            const lottoPrice = isAuto ? 55 : 50; 

            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            let currentTokens = user ? (user.tokens ?? 200) : 200;
            let currentCards = user ? (user.protection_cards ?? 0) : 0;
            let currentStreak = user ? (user.streak ?? 0) : 0;
            let lastCheckin = user ? user.last_checkin : null;

            if (currentTokens < lottoPrice) {
                return message.reply(`❌ 토큰이 부족합니다! 이번 판은 **${lottoPrice} 토큰**이 필요합니다. (현재 잔액: ${currentTokens} 토큰)`);
            }

            let userNumbers = [];

            if (isAuto) {
                while (userNumbers.length < 6) {
                    let num = Math.floor(Math.random() * 45) + 1;
                    if (!userNumbers.includes(num)) userNumbers.push(num);
                }
                userNumbers.sort((a, b) => a - b);
            } else {
                if (args.length !== 6) {
                    return message.reply(`❌ 숫자는 정확히 6개를 띄어쓰기로 입력해 주세요!\n💡 예시: \`!로또 3 12 24 33 39 45\` (50토큰) 또는 \`!로또 자동\` (55토큰)`);
                }
                
                userNumbers = args.map(Number);
                const isValid = userNumbers.every(num => num >= 1 && num <= 45 && !isNaN(num));
                const hasDuplicate = new Set(userNumbers).size !== 6;

                if (!isValid || hasDuplicate) {
                    return message.reply('❌ 1부터 45 사이의 중복 없는 올바른 숫자 6개를 입력해 주세요!');
                }
                userNumbers.sort((a, b) => a - b);
            }

            let winningNumbers = [];
            while (winningNumbers.length < 6) {
                let num = Math.floor(Math.random() * 45) + 1;
                if (!winningNumbers.includes(num)) winningNumbers.push(num);
            }
            winningNumbers.sort((a, b) => a - b);

            let bonusNumber;
            while (true) {
                let num = Math.floor(Math.random() * 45) + 1;
                if (!winningNumbers.includes(num)) {
                    bonusNumber = num;
                    break;
                }
            }

            const matchedCount = userNumbers.filter(num => winningNumbers.includes(num)).length;
            const isBonusMatched = userNumbers.includes(bonusNumber);

            let resultMessage = '';
            let prize = 0;

            if (matchedCount === 6) {
                resultMessage = '🎉 1등 당첨!!! 대박 신화의 주인공이 되셨습니다! 🎉';
                prize = 5000; 
            } else if (matchedCount === 5 && isBonusMatched) {
                resultMessage = '🥈 2등 당첨!! 보너스 번호가 신의 한 수였네요! 🥈';
                prize = 1000; 
            } else if (matchedCount === 5) {
                resultMessage = '🥉 3등 당첨! 엄청난 행운입니다! 🥉';
                prize = 500; 
            } else if (matchedCount === 4) {
                resultMessage = '🏅 4등 당첨! 피자 한 판 가격! 🏅';
                prize = 100; 
            } else if (matchedCount === 3) {
                resultMessage = '◽ 5등 당첨! 본전 치기 성공! ◽';
                prize = 25; 
            } else {
                resultMessage = '😭 낙첨되었습니다... 다음 기회에! 😭';
                prize = 0;
            }

            const finalTokens = currentTokens - lottoPrice + prize;

            await supabase.from('attendance').upsert({
                user_id: userId,
                username: message.author.username,
                tokens: finalTokens,
                protection_cards: currentCards,
                streak: currentStreak,
                last_checkin: lastCheckin
            }, { onConflict: 'user_id' });

            const modeText = isAuto ? '🎲 자동 발급 (55토큰)' : '✍️ 수동 마킹 (50토큰)';
            return message.reply(
                `🎫 **인생역전 로또 결과 고지서 (${modeText})** 🎫\n` +
                `• 선택한 번호: [ ${userNumbers.join(', ')} ]\n` +
                `• 이번주 당첨 번호: [ ${winningNumbers.join(', ')} ] + 보너스 [ ${bonusNumber} ]\n` +
                `-----------------------------------------\n` +
                `🎯 **맞춘 개수:** ${matchedCount}개 ${isBonusMatched ? '(보너스 번호 일치!)' : ''}\n` +
                `📢 **결과:** ${resultMessage}\n` +
                `💰 **정산:** 상금 [ +${prize} 토큰 ] / 판돈 [ -${lottoPrice} 토큰 ]\n` +
                `💳 **현재 잔액:** ${finalTokens} 토큰`
            );
        } catch (err) {
            console.error(err);
            return message.reply("로또 추첨 시스템 구동 중 에러가 발생했습니다.");
        }
    }

    // 출근 단어 예외 처리
    if (message.content !== "출근" && message.content !== "근출" && message.content !== "출" && message.content !== "근" && message.content !== "出勤" && message.content !== "ㅊㄱ" && message.content !== "출첵" && message.content !== "출석" && message.content !== "attend" && message.content !== "근." && message.content !== "출." && message.content !== "출 " && message.content !== "근 " && message.content !== "출군" && message.content !== "앙" && message.content !== "아잉" && message.content !== "웅" && message.content !== "출근해떠염"&& message.content !== "여자" && message.content !== "ㅊㅊ" && message.content !== "시기다른래퍼들의반대편을바라보던래퍼들의배포") return;

    if (currentHour >= 0 && currentHour < 4) {
        return message.reply("🚫 **지금은 출근 금지 시간입니다!**\n상쾌한 아침 공기를 마시며 다시 와주세요! 😴");
    }

    try {
        const { data: user, error: selectError } = await supabase
            .from('attendance')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();

        if (selectError) throw selectError;

        if (user && user.last_checkin === today) {
            return message.reply(`이미 오늘 출근하셨어요! ✨\n(오늘 날짜: ${today})`);
        }

        let earnedTokens = 10;
        if (currentHour < 14) {
            earnedTokens = 20;
        } else if (currentHour < 18) {
            earnedTokens = 15;
        }

        let newStreak = 1;
        if (user && user.last_checkin) {
            const formatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
            const parts = formatter.formatToParts(new Date());
            const y = parts.find(p => p.type === 'year').value;
            const m = parts.find(p => p.type === 'month').value;
            const d = parts.find(p => p.type === 'day').value;
            
            const yesterday = new Date(`${y}-${m}-${d}T12:00:00+09:00`);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];

            if (user.last_checkin === yesterdayStr) {
                newStreak = (user.streak || 0) + 1;
            }
        }

        const totalTokens = (user ? (user.tokens ?? 200) : 200) + earnedTokens;
        const currentCards = user ? (user.protection_cards ?? 0) : 0;

        const { error: upsertError } = await supabase
            .from('attendance')
            .update({
                last_checkin: today,
                streak: newStreak,
                tokens: totalTokens
            })
            .eq('user_id', userId);

        if (!user) {
            await supabase.from('attendance').upsert({
                user_id: userId,
                username: message.author.username,
                last_checkin: today,
                streak: newStreak,
                tokens: totalTokens,
                protection_cards: currentCards
            }, { onConflict: 'user_id' });
        }

        message.reply(`✅ **출근 완료!** 현재 **${newStreak}일** 연속 출근 중! 🔥\n💰 \`${earnedTokens} 토큰\` 획득! (총 보유: \`${totalTokens} 토큰\`)`);

    } catch (err) {
        console.error(err);
        message.reply("⚠️ DB 처리 오류 발생!");
    }
});

client.login(process.env.DISCORD_TOKEN);
