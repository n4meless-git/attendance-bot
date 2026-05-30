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

// 😈 [신규 가변 확률 제어 엔진] 상금 정산 및 확률 증가/경고 처리 함수
async function applySlotWinnings(message, userId, user, netPrize, resultText, slotDisplay, slotPrice, curseType = null) {
    // 기존 확률 혹은 기본값 가져오기
    let currentP444 = user.p_444 ?? 4.0;
    let currentP666 = user.p_666 ?? 1.0;

    let newP444 = currentP444;
    let newP666 = currentP666;

    // 저주에 걸렸다면 기본값으로 리셋, 돈을 땄다면 점진적 상향 (+0.4%, +0.5%)
    if (curseType === '444') {
        newP444 = 4.0;
    } else if (curseType === '666') {
        newP666 = 1.0;
    } else if (netPrize > 0) {
        newP444 = Math.min(currentP444 + 0.4, 99.0);
        newP666 = Math.min(currentP666 + 0.5, 99.0);
    }

    // 10% 단위 돌파 시 DM 경고 시스템
    if (Math.floor(currentP444 / 10) < Math.floor(newP444 / 10)) {
        try {
            await message.author.send(`⚠️ **[경고]** 슬롯머신 과과금으로 인해 **444 사(死)의 저주 확률**이 **${Math.floor(newP444)}%**를 돌파했습니다! 조심하십시오.`);
        } catch (e) { console.error("경고 DM 전송 실패"); }
    }
    if (Math.floor(currentP666 / 10) < Math.floor(newP666 / 10)) {
        try {
            await message.author.send(`💀 **[극비 경고]** 심연의 존재가 당신을 주시합니다. **666 지옥의 저주 확률**이 **${Math.floor(newP666)}%**를 돌파했습니다!`);
        } catch (e) { console.error("경고 DM 전송 실패"); }
    }

    // 최종 잔액 연산 및 데이터 무결성 확보
    let finalTokens = (user.tokens ?? 200) + netPrize;
    if (finalTokens < 0) finalTokens = 0;
    finalTokens = Math.round(finalTokens * 100) / 100;

    await supabase.from('attendance').upsert({
        user_id: userId,
        username: message.author.username,
        tokens: finalTokens,
        protection_cards: user.protection_cards ?? 0,
        streak: user.streak ?? 0,
        last_checkin: user.last_checkin,
        p_444: newP444,
        p_666: newP666
    }, { onConflict: 'user_id' });

    let displayPrizeText = netPrize >= 0 ? `[ +${netPrize} 토큰 ]` : `[ ${netPrize} 토큰 ]`;

    return message.reply(
        `🎰 **SLOT MACHINE** 🎰\n` +
        `${slotDisplay}\n` +
        `-------------------------\n` +
        `${resultText}\n` +
        `💰 **정산:** 상금 및 변동 ${displayPrizeText} / 판돈 [ -${slotPrice} 토큰 ]\n` +
        `💳 **현재 잔액:** ${finalTokens} 토큰 (444: ${newP444.toFixed(1)}% | 666: ${newP666.toFixed(1)}%)`
    );
}

client.once('ready', () => {
    console.log(`✅ 봇 로그인 성공: ${client.user.tag}`);

    // ⏰ 재원이 자동 대리 출근 스케줄러
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

    // 정각 알림 스케줄러
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

    // 매일 밤 23시 59분 자동 방어 및 리셋 스케줄러
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
                                `    *하루 결근 시 자동으로 사용되어 연속 출근 기록을 지켜줍니다.*\n\n` +
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
    // 🎰 [구조 전면 개편] 슬롯머신 분기 통합 시스템
    // ==========================================
    if (message.content === '!도박' || message.content === '!슬롯' || message.content === '!슬롯53' || message.content === '!슬롯7') {
        try {
            const slotPrice = 25; // 판돈 고정

            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            const u = user || { tokens: 200, p_444: 4.0, p_666: 1.0, protection_cards: 0, streak: 0 };
            
            let currentTokens = u.tokens ?? 200;
            if (currentTokens < slotPrice) {
                return message.reply(`❌ 토큰이 부족합니다! 슬롯머신은 **${slotPrice} 토큰**이 필요합니다. (현재 잔액: ${currentTokens} 토큰)`);
            }

            const baseEmojis = ['7️⃣', '💎', '🍀', '🍇', '🍊', '🍒', '🔔'];
            
            // 유저의 동적 가변 확률 추출
            const chance666 = (u.p_666 ?? 1.0) / 100;
            const chance444 = (u.p_444 ?? 4.0) / 100;

            const generateSlotSymbol = () => {
                const rand = Math.random();
                if (rand < chance666) return '6️⃣';
                if (rand < chance666 + chance444) return '4️⃣';
                return baseEmojis[Math.floor(Math.random() * baseEmojis.length)];
            };

            // 1. [슬롯7] 모드 (7x1 배열 단일 추출 로직)
            if (message.content === '!슬롯7') {
                const finalSymbol = generateSlotSymbol();
                let prize = 0;
                let resText = '';

                if (finalSymbol === '7️⃣') { prize = 200; resText = '🎯 **[럭키 세븐] 단일 7 대박! (200토큰 획득)**'; }
                else if (finalSymbol === '💎') { prize = 100; resText = '💎 **[다이아] 단일 다이아몬드! (100토큰 획득)**'; }
                else if (finalSymbol === '6️⃣') { prize = -150; resText = '💀 **[악마의 단상] 단일 6 소멸! (150토큰 차감)**'; }
                else if (finalSymbol === '4️⃣') { prize = -50; resText = '👁️ **[불길한 징조] 단일 4 차감! (50토큰 차감)**'; }
                else { prize = 10; resText = '🎉 **[소소한 당첨] 과일이 나왔습니다! (10토큰 획득)**'; }

                return applySlotWinnings(message, userId, u, prize - slotPrice, resText, `[ ${finalSymbol} ]`, slotPrice, finalSymbol === '4️⃣' ? '444_single' : (finalSymbol === '6️⃣' ? '666_single' : null));
            }

            // 2. [슬롯53] 및 기존 [!도박/!슬롯] 공통 처리 (3칸 판정 로직)
            const slot1 = generateSlotSymbol();
            const slot2 = generateSlotSymbol();
            const slot3 = generateSlotSymbol();
            const slotDisplay = `[ ${slot1} | ${slot2} | ${slot3} ]`;

            let prize = 0;
            let curseType = null; 
            let resultText = '';

            if (slot1 === '6️⃣' && slot2 === '6️⃣' && slot3 === '6️⃣') {
                curseType = '666';
                resultText = '💀☠️ **[대재앙] 6 6 6 지옥의 문이 열렸습니다!!! 영혼과 함께 1500토큰이 증발합니다!!!** ☠️💀';
            }
            else if (slot1 === '4️⃣' && slot2 === '4️⃣' && slot3 === '4️⃣') {
                curseType = '444';
                resultText = '👁️🚨 **[경고] 4 4 4 사(死)의 저주가 내렸습니다! 불길한 기운과 함께 444.4토큰이 소멸합니다!** 🚨👁️';
            }
            else if (slot1 === slot2 && slot2 === slot3) {
                if (slot1 === '7️⃣') { prize = 1000; resultText = '🔥 **[신화] 777 대박 잭팟!!! 대륙이 진동합니다! (1000토큰 획득)** 🔥'; }
                else if (slot1 === '💎') { prize = 600; resultText = '💎 **[전설] 다이아몬드 잭팟!!! 서버의 지배자! (600토큰 획득)** 💎'; }
                else if (slot1 === '🍀') { prize = 300; resultText = '🍀 **[에픽] 네잎클로버 잭팟!!! 신이 내린 행운! (300토큰 획득)** 🍀'; }
                else { prize = 75; resultText = `🎰 **[일반] 잭팟! [ ${slot1} ] 3개가 일치합니다! (75토큰 획득)** 🎰`; }
            } 
            else if (slot1 === '🍀' && slot3 === '🍀' && slot2 !== '🍀') {
                prize = 150;
                resultText = '🍀✨ **[시크릿] 클로버 더블 윙! 양 옆에 대박 행운이 깃듭니다! (150토큰 획득)** ✨🍀';
            }
            else if ((slot1 === '💎' && slot2 === '💎') || (slot2 === '💎' && slot3 === '💎') || (slot1 === '💎' && slot3 === '💎')) {
                prize = 100;
                resultText = '💎✨ **[더블 💎] 다이아몬드가 2개! 엄청난 자산 가치입니다! (100토큰 획득)** ✨💎';
            }
            else if ((slot1 === slot2 || slot2 === slot3 || slot1 === slot3) && 
                     slot1 !== '6️⃣' && slot2 !== '6️⃣' && slot3 !== '6️⃣' &&
                     slot1 !== '4️⃣' && slot2 !== '4️⃣' && slot3 !== '4️⃣') {
                prize = 15;
                resultText = '🎉 **축하합니다! 그림 2개가 일치합니다! (15토큰 획득)** 🎉';
            } 
            else {
                prize = 0;
                resultText = '😭 **아쉽게도 낙첨되었습니다. 다음 기회에!** 😭';
            }

            let netPrize = prize - slotPrice;
            if (curseType === '666') netPrize = -slotPrice - 1500;
            if (curseType === '444') netPrize = -slotPrice - 444.4;

            return applySlotWinnings(message, userId, u, netPrize, resultText, slotDisplay, slotPrice, curseType);

        } catch (err) {
            console.error(err);
            return message.reply("슬롯머신 구동 중 시스템 오류가 발생했습니다.");
        }
    }

    // 3. [슬롯35] 모드 전용 (뒤집힌 화면 활성화 및 메모리 스냅샷 생성)
    if (message.content === '!슬롯35') {
        try {
            const slotPrice = 25;
            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            const u = user || { tokens: 200 };

            if ((u.tokens ?? 200) < slotPrice) {
                return message.reply(`❌ 토큰이 부족합니다! 슬롯35는 **${slotPrice} 토큰**이 필요합니다.`);
            }

            const baseEmojis = ['7️⃣', '💎', '🍀', '🍇', '🍊', '🍒', '🔔'];
            const chance666 = (u.p_666 ?? 1.0) / 100;
            const chance444 = (u.p_444 ?? 4.0) / 100;

            // 15개 칸 내부에 미리 이모지를 숨겨 놓음 (서버 사이드 고정)
            const hiddenBoard = Array.from({length: 15}, () => {
                const rand = Math.random();
                if (rand < chance666) return '6️⃣';
                if (rand < chance666 + chance444) return '4️⃣';
                return baseEmojis[Math.floor(Math.random() * baseEmojis.length)];
            });

            // 임시로 글로벌 맵 등에 유저의 보드 상태와 판돈 결제 대기를 상태 기록 (또는 데이터베이스 메타 보관)
            if (!client.slot35Data) client.slot35Data = new Map();
            client.slot35Data.set(userId, { hiddenBoard, timestamp: Date.now() });

            return message.reply(
                `🎲 **[슬롯35: 스페셜 뒤집기 모드]** 판돈 **25 토큰**이 대기 중입니다.\n` +
                `아래 15개의 ❓ 카드 중 대박을 숨겨놓은 **3개의 번호**를 선택하세요!\n\n` +
                `1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣\n6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟\n⑪ ⑫ ⑬ ⑭ ⑮\n\n` +
                `👉 **입력 방식:** \`!선택 3 7 12\` (1부터 15 사이의 공백 구분 숫자 3개)`
            );
        } catch (e) {
            return message.reply("슬롯35 시스템 생성 중 오류가 발생했습니다.");
        }
    }

    // 4. [슬롯35 연결 명령어] !선택 처리기
    if (message.content.startsWith('!선택')) {
        try {
            if (!client.slot35Data || !client.slot35Data.has(userId)) {
                return message.reply("❌ 활성화된 슬롯35 게임 판이 없습니다. 먼저 \`!슬롯35\`를 호출해 주세요!");
            }

            const args = message.content.split(' ').slice(1);
            if (args.length !== 3) {
                return message.reply("❌ 정확히 3개의 번호를 선택해 주세요! 예시: \`!선택 1 5 14\`");
            }

            const chosenIndices = args.map(num => parseInt(num, 10) - 1);
            const isValid = chosenIndices.every(idx => idx >= 0 && idx < 15 && !isNaN(idx));
            const isUnique = new Set(chosenIndices).size === 3;

            if (!isValid || !isUnique) {
                return message.reply("❌ 1부터 15 사이의 중복 없는 올바른 번호 3개를 고르셔야 합니다.");
            }

            const session = client.slot35Data.get(userId);
            client.slot35Data.delete(userId); // 세션 만료화 처리

            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            const u = user || { tokens: 200, p_444: 4.0, p_666: 1.0 };

            const s1 = session.hiddenBoard[chosenIndices[0]];
            const s2 = session.hiddenBoard[chosenIndices[1]];
            const s3 = session.hiddenBoard[chosenIndices[2]];

            let prize = 0;
            let curseType = null;
            let resultText = '';
            const slotDisplay = `🎰 **내가 고른 카드 뒤집기 결과:** [ ${s1} | ${s2} | ${s3} ]`;

            // 동일한 조합 규칙 보상 체계 계승
            if (s1 === '6️⃣' && s2 === '6️⃣' && s3 === '6️⃣') {
                curseType = '666';
                resultText = '💀☠️ **[슬롯35 대재앙] 6 6 6 심연을 골랐습니다! 1500토큰이 강제 폭파됩니다!** ☠️💀';
            } else if (s1 === '4️⃣' && s2 === '4️⃣' && s3 === '4️⃣') {
                curseType = '444';
                resultText = '👁️🚨 **[슬롯35 죽음] 4 4 4 금단의 카드를 오픈했습니다! 444.4토큰 소멸!** 🚨👁️';
            } else if (s1 === s2 && s2 === s3) {
                if (s1 === '7️⃣') { prize = 1500; resultText = '🔥 **[슬롯35 신화] 777 선택 성공!!! 신의 손놀림! (1500토큰 획득)** 🔥'; }
                else if (s1 === '💎') { prize = 900; resultText = '💎 **[슬롯35 전설] 다이아몬드 트리플! (900토큰 획득)** 💎'; }
                else { prize = 150; resultText = `🎰 **[슬롯35 일반] 트리플 세트 일치! (150토큰 획득)** 🎰`; }
            } else if ((s1 === s2 || s2 === s3 || s1 === s3) && s1 !== '6️⃣' && s2 !== '6️⃣' && s3 !== '6️⃣' && s1 !== '4️⃣' && s2 !== '4️⃣' && s3 !== '4️⃣') {
                prize = 30; // 뒤집기 스페셜 보정 보상 상향
                resultText = '🎉 **[슬롯35 당첨] 페어 세트 성공! 2개의 카드가 일치합니다. (30토큰 획득)** 🎉';
            } else {
                prize = 0;
                resultText = '😭 **[슬롯35 꽝] 카드가 전부 엇갈렸습니다. 다음 기회에 번호를 잘 노려보세요!** 😭';
            }

            const slotPrice = 25;
            let netPrize = prize - slotPrice;
            if (curseType === '666') netPrize = -slotPrice - 1500;
            if (curseType === '444') netPrize = -slotPrice - 444.4;

            return applySlotWinnings(message, userId, u, netPrize, resultText, slotDisplay, slotPrice, curseType);

        } catch (err) {
            console.error(err);
            return message.reply("슬롯35 정산 중 예상치 못한 에러가 터졌습니다.");
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
